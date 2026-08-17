#!/usr/bin/env node
/**
 * Crop false-merge faces (Person 308 A & B) — bbox crop + aligned 112x112 —
 * to PNG so we can visually verify what these detections actually are.
 *
 * Usage:
 *   cd desktop && node scripts/prepare-native.mjs electron && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/crop-308.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const sharp = require('sharp')
const { FaceAnalysis, ARCFACE_DST } = require('../dist-main/ml/faceAnalysis.js')
const { decodeRgb, warpAffine } = require('../dist-main/ml/image.js')
const { umeyama } = require('../dist-main/ml/matrix.js')

const MODELS_DIR = process.env.PICLY_MODELS_DIR || path.join(__dirname, '..', 'models')
process.env.PICLY_MODELS_DIR = MODELS_DIR

const OUT_DIR = path.join(__dirname, '..', 'data', 'debug', 'p308')
fs.mkdirSync(OUT_DIR, { recursive: true })

let analysis

async function saveRgb(img, name) {
  await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), {
    raw: { width: img.width, height: img.height, channels: 3 },
  }).png().toFile(path.join(OUT_DIR, name))
}

async function getFace(photo, cx, cy) {
  const img = await decodeRgb(photo)
  const dets = await analysis.detectFromImage(img)
  let best = null
  let bestD = Infinity
  for (const d of dets) {
    const c = [(d.bbox[0] + d.bbox[2]) / 2, (d.bbox[1] + d.bbox[3]) / 2]
    const dist = Math.hypot(c[0] - cx, c[1] - cy)
    if (dist < bestD) { bestD = dist; best = d }
  }
  return { face: best, dist: bestD }
}

async function main() {
  analysis = await FaceAnalysis.create({ embed: false })

  const cases = [
    { name: 'A_DSC02286_behind', path: '/Volumes/X/Dataset/psdkp/DSC02286.JPG', cx: 5092, cy: 1138 },
    { name: 'B_DSC02490_side', path: '/Volumes/X/Dataset/psdkp/DSC02490.JPG', cx: 5177, cy: 1606 },
    { name: 'C_DSC02286_real', path: '/Volumes/X/Dataset/psdkp/DSC02286.JPG', cx: 2170, cy: 1798 }, // 441px frontal
  ]

  for (const c of cases) {
    const { face: f, dist } = await getFace(c.path, c.cx, c.cy)
    if (!f) { console.log(`${c.name}: NOT FOUND (dist ${dist})`); continue }
    const [x1, y1, x2, y2] = f.bbox.map((v) => Math.round(v))
    const bw = x2 - x1
    const bh = y2 - y1
    // bbox crop with 25% padding
    const px = Math.round(bw * 0.25)
    const py = Math.round(bh * 0.25)
    const img = await decodeRgb(c.path)
    const padL = Math.max(0, x1 - px)
    const padT = Math.max(0, y1 - py)
    const padR = Math.min(img.width, x2 + px)
    const padB = Math.min(img.height, y2 + py)
    const crop = { width: padR - padL, height: padB - padT, data: new Uint8Array((padR - padL) * (padB - padT) * 3) }
    for (let y = 0; y < crop.height; y++) {
      for (let xx = 0; xx < crop.width; xx++) {
        const si = ((y + padT) * img.width + (xx + padL)) * 3
        const di = (y * crop.width + xx) * 3
        crop.data[di] = img.data[si]
        crop.data[di + 1] = img.data[si + 1]
        crop.data[di + 2] = img.data[si + 2]
      }
    }
    await saveRgb(crop, `${c.name}_bbox.png`)

    const M = umeyama(f.kps, ARCFACE_DST)
    const aimg = warpAffine(img, M, 112)
    const up = { width: 112, height: 112, data: new Uint8Array(112 * 112 * 3) }
    for (let i = 0; i < up.data.length; i++) up.data[i] = aimg.data[i]
    await sharp(Buffer.from(up.data.buffer), { raw: { width: 112, height: 112, channels: 3 } })
      .resize(448, 448, { kernel: 'nearest' })
      .png().toFile(path.join(OUT_DIR, `${c.name}_aligned.png`))

    console.log(`${c.name}: size=${Math.round(Math.max(bw, bh))} q=${f.quality} dist=${dist.toFixed(0)}px`)
  }
  console.log(`\nSaved to ${OUT_DIR}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
