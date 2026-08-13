/**
 * Visual alignment debug (STEP 3): for sample faces in each size bucket, render
 * a side-by-side grid:
 *
 *   ORIGINAL (bbox + landmarks) | ALIGNED CROP (warpAffine to 112) | FINAL 112x112
 *
 * This lets us verify the alignment is visually correct: eyes level, face
 * centered, not cropped/zoomed/flipped, colors sane.
 *
 * Overlays are drawn directly into the raw pixel buffer (no SVG composite):
 * the sharp build shipped inside Electron has no SVG input support, so SVG
 * overlays fail with "Image to composite must have same dimensions or smaller".
 *
 * Usage:
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/visual-align.cjs <photo> [nPerBucket]
 *
 * Output: desktop/data/debug/visual-align/<photo-basename>-<bucket>.jpg
 */
const path = require('node:path')
const fs = require('node:fs')
const sharp = require('sharp')
const { FaceAnalysis, ARCFACE_DST } = require('../dist-main/ml/faceAnalysis.js')
const { decodeRgb, warpAffine } = require('../dist-main/ml/image.js')
const { umeyama } = require('../dist-main/ml/matrix.js')

const PHOTO = process.argv[2]
if (!PHOTO) { console.error('usage: visual-align.cjs <photo> [nPerBucket]'); process.exit(1) }
const N = Number(process.argv[3] ?? 4)

const OUT_DIR = path.join(__dirname, '..', 'data', 'debug', 'visual-align')
fs.mkdirSync(OUT_DIR, { recursive: true })

const BUCKETS = [
  { name: 'gt100', min: 100.5, max: Infinity },
  { name: '64-100', min: 64.5, max: 100.5 },
  { name: '32-64', min: 32.5, max: 64.5 },
  { name: '20-32', min: 20.5, max: 32.5 },
  { name: 'lt20', min: 1, max: 20.5 },
]
const bucketOf = (side) => BUCKETS.find((b) => side >= b.min && side < b.max)?.name ?? '?'

/** Render an RGB buffer into a JPEG buffer. */
async function jpegOf(rgb, w, h) {
  return sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 90 }).toBuffer()
}

/**
 * Draw a colored rect outline + 5 landmark dots into an RGB buffer in place.
 * All coordinates are in the buffer's local space.
 */
function drawMarkers(buf, w, h, bbox, kps, thickness = 3) {
  const [x1, y1, x2, y2] = bbox.map((v) => Math.round(v))
  const cx1 = Math.max(0, Math.min(w - 1, x1))
  const cy1 = Math.max(0, Math.min(h - 1, y1))
  const cx2 = Math.max(0, Math.min(w - 1, x2))
  const cy2 = Math.max(0, Math.min(h - 1, y2))
  // rect outline color: green
  const set = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return
    const off = (y * w + x) * 3
    buf[off] = r; buf[off + 1] = g; buf[off + 2] = b
  }
  for (let i = 0; i < thickness; i++) {
    for (let x = cx1; x <= cx2; x++) { set(x, cy1 + i, 0, 255, 0); set(x, cy2 - i, 0, 255, 0) }
    for (let y = cy1; y <= cy2; y++) { set(cx1 + i, y, 0, 255, 0); set(cx2 - i, y, 0, 255, 0) }
  }
  // landmark dots (yellow)
  for (const [kx, ky] of kps) {
    const dx = Math.round(kx)
    const dy = Math.round(ky)
    for (let ox = -3; ox <= 3; ox++) {
      for (let oy = -3; oy <= 3; oy++) {
        if (ox * ox + oy * oy <= 9) set(dx + ox, dy + oy, 255, 209, 102)
      }
    }
  }
}

async function main() {
  const analysis = await FaceAnalysis.create({ embed: false })
  const img = await decodeRgb(PHOTO)
  const faces = await analysis.detectFromImage(img)
  console.log(`photo: ${path.basename(PHOTO)} ${img.width}x${img.height} faces=${faces.length}`)

  // Group faces by bucket, take first N of each.
  const perBucket = new Map()
  for (const f of faces) {
    const side = Math.max(f.bbox[2] - f.bbox[0], f.bbox[3] - f.bbox[1])
    const b = bucketOf(side)
    if (!perBucket.has(b)) perBucket.set(b, [])
    if (perBucket.get(b).length < N) perBucket.get(b).push({ face: f, side })
  }

  for (const [bucket, list] of perBucket) {
    const tiles = []
    for (const { face } of list) {
      const [x1, y1, x2, y2] = face.bbox
      const side = Math.max(x2 - x1, y2 - y1)
      // --- ORIGINAL crop (bbox + landmarks drawn raw) ---
      const pad = Math.max(20, Math.round(side * 0.4))
      const ox1 = Math.max(0, Math.floor(x1 - pad))
      const oy1 = Math.max(0, Math.floor(y1 - pad))
      const ox2 = Math.min(img.width, Math.ceil(x2 + pad))
      const oy2 = Math.min(img.height, Math.ceil(y2 + pad))
      const ow = ox2 - ox1
      const oh = oy2 - oy1
      // Rebuild crop row by row (a plain subarray would be wrong for multi-row).
      const cropBuf = Buffer.alloc(ow * oh * 3)
      for (let yy = 0; yy < oh; yy++) {
        const srcOff = ((oy1 + yy) * img.width + ox1) * 3
        img.data.copy(cropBuf, yy * ow * 3, srcOff, srcOff + ow * 3)
      }
      const kpsLocal = face.kps.map(([x, y]) => [x - ox1, y - oy1])
      drawMarkers(cropBuf, ow, oh, [x1 - ox1, y1 - oy1, x2 - ox1, y2 - oy1], kpsLocal)
      const origJpeg = await sharp(cropBuf, { raw: { width: ow, height: oh, channels: 3 } })
        .resize(168, 168, { fit: 'contain', background: { r: 20, g: 20, b: 24 } })
        .jpeg({ quality: 90 })
        .toBuffer()

      // --- ALIGNED crop (warpAffine to 112) ---
      const M = umeyama(face.kps, ARCFACE_DST)
      const aligned = warpAffine(img, M, 112)
      const alignedJpeg = await jpegOf(aligned.data, 112, 112)

      // --- FINAL 112x112 (same as aligned; the actual model input is exactly this) ---
      const finalJpeg = await jpegOf(aligned.data, 112, 112)

      tiles.push({ origJpeg, alignedJpeg, finalJpeg })
    }

    // Stack horizontally: for each face, 3 columns.
    const perRow = 2
    const rows = []
    for (let i = 0; i < tiles.length; i += perRow) {
      const rowTiles = tiles.slice(i, i + perRow)
      const cols = []
      for (const t of rowTiles) {
        cols.push(
          await sharp(t.origJpeg).toBuffer(),
          await sharp(t.alignedJpeg).toBuffer(),
          await sharp(t.finalJpeg).toBuffer(),
        )
      }
      const rowBuf = await sharp({ create: { width: 168 * cols.length, height: 168, channels: 3, background: { r: 20, g: 20, b: 24 } } })
        .composite(cols.map((b, idx) => ({ input: b, left: idx * 168, top: 0 })))
        .jpeg({ quality: 90 })
        .toBuffer()
      rows.push(rowBuf)
    }
    const totalH = rows.length * 168
    const width = 168 * Math.min(perRow, tiles.length) * 3
    const grid = await sharp({ create: { width, height: totalH, channels: 3, background: { r: 20, g: 20, b: 24 } } })
      .composite(rows.map((b, idx) => ({ input: b, left: 0, top: idx * 168 })))
      .jpeg({ quality: 90 })
      .toBuffer()
    const out = path.join(OUT_DIR, `${path.basename(PHOTO).replace(/\.[^.]+$/, '')}-${bucket}.jpg`)
    fs.writeFileSync(out, grid)
    console.log(`  ${bucket}: ${list.length} faces -> ${path.basename(out)}`)
  }
  console.log(`\nOutput: ${OUT_DIR}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
