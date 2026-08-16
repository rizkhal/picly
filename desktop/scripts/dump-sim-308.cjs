#!/usr/bin/env node
/**
 * Dump eDifFIQA + embedding pair-similarity for the Person-308 false-merge
 * faces vs a sample of real high-tier faces (PSdKP), using the SAME embedding
 * pipeline as production (umeyama warp -> ArcFace -> L2).
 *
 * Usage:
 *   cd desktop && node scripts/prepare-native.mjs electron && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/dump-sim-308.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const { FaceAnalysis, ARCFACE_DST } = require('../dist-main/ml/faceAnalysis.js')
const { decodeRgb, warpAffine } = require('../dist-main/ml/image.js')
const { QualityScorer } = require('../dist-main/ml/quality.js')
const { ArcFaceEmbedder } = require('../dist-main/ml/arcface.js')
const { umeyama } = require('../dist-main/ml/matrix.js')
const { buffaloL } = require('../dist-main/ml/config.js')

const MODELS_DIR = process.env.PICLY_MODELS_DIR || path.join(__dirname, '..', 'models')
process.env.PICLY_MODELS_DIR = MODELS_DIR

let analysis
let embedder
let qualityScorer
let imgCache = new Map()

function cosine(a, b) {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

async function decodeCached(p) {
  if (!imgCache.has(p)) imgCache.set(p, await decodeRgb(p))
  return imgCache.get(p)
}

async function embedFace(photo, kps) {
  const img = await decodeCached(photo)
  const M = umeyama(kps, ARCFACE_DST)
  const aimg = warpAffine(img, M, 112)
  const feat = await embedder.getFeat(aimg)
  return { feat: embedder.l2Normalize(feat), aimg }
}

async function eqOf(photo, kps) {
  const { aimg } = await embedFace(photo, kps)
  return qualityScorer.scoreAligned(aimg)
}

async function getFace(photo, cx, cy) {
  const img = await decodeCached(photo)
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
  analysis = await FaceAnalysis.create({ embed: true })
  embedder = await ArcFaceEmbedder.create(buffaloL(MODELS_DIR))
  qualityScorer = await QualityScorer.create(path.join(MODELS_DIR, 'ediffiqa', 'ediffiqa_t.onnx'))

  const FA = { path: '/Volumes/X/Dataset/psdkp/DSC02286.JPG', cx: 5092, cy: 1138 }
  const FB = { path: '/Volumes/X/Dataset/psdkp/DSC02490.JPG', cx: 5177, cy: 1606 }
  const { face: fa, dist: da } = await getFace(FA.path, FA.cx, FA.cy)
  const { face: fb, dist: db } = await getFace(FB.path, FB.cx, FB.cy)
  const sA = Math.round(Math.max(fa.bbox[2] - fa.bbox[0], fa.bbox[3] - fa.bbox[1]))
  const sB = Math.round(Math.max(fb.bbox[2] - fb.bbox[0], fb.bbox[3] - fb.bbox[1]))
  console.log(`FACE A (DSC02286 behind) dist=${da.toFixed(0)} size=${sA} q=${fa.quality} qs=${fa.qualityScore.toFixed(3)}`)
  console.log(`FACE B (DSC02490 side)   dist=${db.toFixed(0)} size=${sB} q=${fb.quality} qs=${fb.qualityScore.toFixed(3)}`)

  // Use the SAME ArcFace embedding as detectFromImage would produce.
  const sim = cosine(
    (await embedFace(FA.path, fa.kps)).feat,
    (await embedFace(FB.path, fb.kps)).feat,
  )
  console.log(`\nSim A<->B = ${sim.toFixed(3)}  (cluster at >=0.45; merge=${sim >= 0.45})`)
  console.log(`eqScore A = ${(await eqOf(FA.path, fa.kps)).toFixed(3)}   eqScore B = ${(await eqOf(FB.path, fb.kps)).toFixed(3)}`)

  // Real-face distribution (>=64px high-tier anchors) for eqScore + inter-face sims.
  const dir = '/Volumes/X/Dataset/psdkp-sample-tile'
  const files = fs.readdirSync(dir).filter((f) => /\.JPG$/i.test(f) && !f.startsWith('._')).sort()
  const eqs = []
  const pairs = []
  const faces = []
  for (const fn of files) {
    const img = await decodeCached(path.join(dir, fn))
    const dets = await analysis.detectFromImage(img)
    for (const d of dets) {
      const s = Math.max(d.bbox[2] - d.bbox[0], d.bbox[3] - d.bbox[1])
      if (s < 64) continue
      eqs.push(await eqOf(path.join(dir, fn), d.kps))
      faces.push({ file: fn, face: d })
    }
  }
  eqs.sort((a, b) => a - b)
  const pct = (p) => eqs[Math.min(eqs.length - 1, Math.floor((p / 100) * eqs.length))].toFixed(3)
  console.log(`\n=== eDifFIQA for real >=64px faces (n=${eqs.length}) ===`)
  console.log(`  min=${pct(0)} p10=${pct(10)} p25=${pct(25)} med=${pct(50)} p75=${pct(75)} p90=${pct(90)} max=${pct(100)}`)

  // Cap pair sims to a tractable random sample (same-photo pairs only => diff persons).
  const perPhoto = new Map()
  for (const f of faces) {
    if (!perPhoto.has(f.file)) perPhoto.set(f.file, [])
    perPhoto.get(f.file).push(f)
  }
  for (const [file, arr] of perPhoto) {
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        if (pairs.length >= 400) break
        pairs.push({ file, s: cosine((await embedFace(path.join(dir, file), arr[i].face.kps)).feat, (await embedFace(path.join(dir, file), arr[j].face.kps)).feat) })
      }
      if (pairs.length >= 400) break
    }
    if (pairs.length >= 400) break
  }
  const sorted = pairs.map((p) => p.s).sort((a, b) => a - b)
  const pct2 = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))].toFixed(3)
  console.log(`\n=== within-photo (different-person) sims >=64px faces (n=${pairs.length}) ===`)
  console.log(`  min=${pct2(0)} p10=${pct2(10)} p25=${pct2(25)} med=${pct2(50)} p75=${pct2(75)} p90=${pct2(90)} max=${pct2(100)}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
