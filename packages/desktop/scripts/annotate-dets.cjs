/**
 * Annotate detections on a photo and write a JPG. Green = kept faces.
 * Overlay drawn as an SVG so it composites cleanly on top of the raw buffer.
 * Output: <photo>.annotated.jpg next to the input.
 *
 * Usage:
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/annotate-dets.cjs <photo> [fullThresh tileThresh rePx nmsIou]
 */
const path = require('node:path')
const sharp = require('sharp')
const { FaceAnalysis } = require('../dist-main/ml/faceAnalysis.js')
const { decodeRgb } = require('../dist-main/ml/image.js')

const PHOTO = process.argv[2]
if (!PHOTO) { console.error('usage: annotate-dets.cjs <photo>'); process.exit(1) }
const full = Number(process.argv[3] ?? 0.5)
const tile = Number(process.argv[4] ?? 0.5)
const rePx = Number(process.argv[5] ?? 80)
const nms = Number(process.argv[6] ?? 0.3)

const OUT = PHOTO.replace(/\.(jpe?g|png)$/i, '.annotated.jpg')

async function main() {
  const analysis = await FaceAnalysis.create({
    fullDetThresh: full,
    tileDetThresh: tile,
    reDetectFacePx: rePx,
    nmsIou: nms,
    minFacePx: 16,
    minFaceScore: 0.3,
    tileOverlap: 0,
    embed: false,
  })
  const img = await decodeRgb(PHOTO)
  const faces = await analysis.detectFromImage(img)
  const bd = analysis.lastBreakdown
  console.log(`detections: ${faces.length} (raw ${bd.rawFull}+${bd.rawTile} -> NMS ${bd.afterNms} -> gate ${bd.afterGate})`)

  // Build an SVG overlay with green rects (stroke only).
  const rects = faces.map((f) => {
    const [x1, y1, x2, y2] = f.bbox.map((v) => Math.round(v))
    return `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" fill="none" stroke="#00ff00" stroke-width="4"/>`
  }).join('')
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${img.width}" height="${img.height}">${rects}</svg>`)

  const out = await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 3 } })
    .composite([{ input: svg, top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toFile(OUT)
  console.log(`wrote ${OUT} (${out.width}x${out.height})`)
}

main().catch((e) => { console.error(e); process.exit(1) })
