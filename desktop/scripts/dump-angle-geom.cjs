#!/usr/bin/env node
/**
 * Dump detection geometry for the false-merge case (Person 308: DSC02286 from
 * behind, DSC02490 from the side) vs real faces from psdkp-sample-tile.
 *
 * Goal: BEFORE implementing an eye-centric geometry gate, look at real numbers —
 * where are the eyes/nose inside the bbox for real faces vs junk/angle faces?
 *
 * Usage:
 *   cd desktop && node scripts/prepare-native.mjs electron && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/dump-angle-geom.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const { FaceAnalysis } = require('../dist-main/ml/faceAnalysis.js')
const { decodeRgb } = require('../dist-main/ml/image.js')

const MODELS_DIR = process.env.PICLY_MODELS_DIR || path.join(__dirname, '..', 'models')
process.env.PICLY_MODELS_DIR = MODELS_DIR

// SCRFD kps order: [rightEye, leftEye, nose, rightMouth, leftMouth]
function geom(bbox, kps, score) {
  const [x1, y1, x2, y2] = bbox
  const bw = x2 - x1
  const bh = y2 - y1
  const re = kps[0]
  const le = kps[1]
  const nose = kps[2]
  const eyeDist = Math.hypot(re[0] - le[0], re[1] - le[1]) || 1
  const eyeMid = [(re[0] + le[0]) / 2, (re[1] + le[1]) / 2]
  return {
    size: Math.round(Math.max(bw, bh)),
    score: +score.toFixed(3),
    // Eyes span as fraction of min(bw,bh) — tiny => landmarks suspect.
    eyeDistRatio: +(eyeDist / Math.max(1, Math.min(bw, bh))).toFixed(3),
    // Eye line vertical position inside bbox (0=top, 1=bottom). Real faces: ~0.3-0.45.
    eyeYRatio: +((eyeMid[1] - y1) / Math.max(1, bh)).toFixed(3),
    // Nose below eye line (positive = below). Real frontal: > 0.
    noseBelowEye: +((nose[1] - eyeMid[1]) / Math.max(1, bh)).toFixed(3),
    // Yaw proxy: horizontal nose offset vs eye midpoint, normalized by eyeDist.
    // 0 = frontal, ~0.5+ = strong profile.
    yawRatio: +((nose[0] - eyeMid[0]) / eyeDist).toFixed(3),
    eyeMidXRatio: +((eyeMid[0] - x1) / Math.max(1, bw)).toFixed(3),
    bbox: bbox.map((v) => Math.round(v)).join(','),
    kps: kps.map((p) => p.map((v) => Math.round(v)).join(',')).join(' | '),
  }
}

function nearDb(a, db) {
  const cxa = (a[0] + a[2]) / 2
  const cya = (a[1] + a[3]) / 2
  const cxb = (db[0] + db[2]) / 2
  const cyb = (db[1] + db[3]) / 2
  return Math.hypot(cxa - cxb, cya - cyb) < 60
}

let analysis

async function dumpPhoto(label, photoPath, dbBbox) {
  const img = await decodeRgb(photoPath)
  const dets = await analysis.detectFromImage(img)
  console.log(`\n=== ${label} (${path.basename(photoPath)}) — ${img.width}x${img.height}, ${dets.length} detections ===`)
  for (const d of dets) {
    const mark = dbBbox && nearDb(d.bbox, dbBbox) ? '  <<< DB MATCH' : ''
    console.log(' ', JSON.stringify(geom(d.bbox, d.kps, d.detScore)), 'q=' + d.quality, mark)
  }
}

async function dumpRealFaces() {
  const dir = '/Volumes/X/Dataset/psdkp-sample-tile'
  const files = fs.readdirSync(dir).filter((f) => /\.JPG$/i.test(f) && !f.startsWith('._')).sort()
  const rows = []
  for (const fn of files) {
    const img = await decodeRgb(path.join(dir, fn))
    const dets = await analysis.detectFromImage(img)
    for (const d of dets) {
      rows.push({ file: fn, ...geom(d.bbox, d.kps, d.detScore), quality: d.quality })
    }
  }
  console.log(`\n=== REAL FACES ${dir} — ${rows.length} total ===`)
  const pct = (arr, p) => {
    const s = [...arr].sort((a, b) => a - b)
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))].toFixed(3)
  }
  const stat = (name, fn) => {
    const vals = rows.map(fn)
    console.log(`  ${name.padEnd(14)} min=${pct(vals, 0)} p25=${pct(vals, 25)} med=${pct(vals, 50)} p75=${pct(vals, 75)} p90=${pct(vals, 90)} max=${pct(vals, 100)}`)
  }
  stat('size', (r) => r.size)
  stat('eyeYRatio', (r) => r.eyeYRatio)
  stat('yawRatio', (r) => r.yawRatio)
  stat('noseBelowEye', (r) => r.noseBelowEye)
  stat('eyeDistRatio', (r) => r.eyeDistRatio)
  // Only >=64px (would be high tier) rows, since those drive clustering anchors.
  console.log('\n  --- only side>=64px (anchor candidates) ---')
  const big = rows.filter((r) => r.size >= 64)
  const stat2 = (name, fn) => {
    const vals = big.map(fn)
    console.log(`  ${name.padEnd(14)} min=${pct(vals, 0)} p25=${pct(vals, 25)} med=${pct(vals, 50)} p75=${pct(vals, 75)} p90=${pct(vals, 90)} max=${pct(vals, 100)}`)
  }
  stat2('eyeYRatio', (r) => r.eyeYRatio)
  stat2('yawRatio', (r) => r.yawRatio)
  stat2('noseBelowEye', (r) => r.noseBelowEye)
  for (const r of big) {
    console.log(`   ${r.file.padEnd(30)} size=${String(r.size).padStart(4)} score=${r.score} eyeY=${r.eyeYRatio} yaw=${r.yawRatio} noseD=${r.noseBelowEye} eyeD=${r.eyeDistRatio}`)
  }
}

async function main() {
  analysis = await FaceAnalysis.create({ embed: false })
  await dumpPhoto('FALSE-MERGE A (from behind)', '/Volumes/X/Dataset/psdkp/DSC02286.JPG', [4984, 1025, 5201, 1251])
  await dumpPhoto('FALSE-MERGE B (from side)', '/Volumes/X/Dataset/psdkp/DSC02490.JPG', [5110, 1509, 5244, 1703])
  await dumpRealFaces()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
