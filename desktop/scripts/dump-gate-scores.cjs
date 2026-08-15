#!/usr/bin/env node
/**
 * Dump every detection with its eDifFIQA score so we can manually verify
 * whether faces downgraded by the gate are actually non-face (correct) or real
 * faces (false positive). Also prints the count of P41 (phantom) faces that
 * survive embedding.
 *
 * Usage:
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/dump-gate-scores.cjs [threshold]
 */
const path = require('node:path')
const fs = require('node:fs')
const { FaceAnalysis } = require('../dist-main/ml/faceAnalysis.js')
const { decodeRgb } = require('../dist-main/ml/image.js')

const DIR = process.env.PSDKP_DIR || '/Volumes/X/Dataset/psdkp-sample-tile'
const P41_DUMP = '/tmp/picly-bench/person41-kps.json'
const THRESH = Number(process.argv[2] || 0.2)
const DESKTOP_ROOT = path.join(__dirname, '..')
process.env.PICLY_MODELS_DIR = process.env.PICLY_MODELS_DIR || path.join(DESKTOP_ROOT, 'models')

function loadContext() {
  const photos = fs.readdirSync(DIR).filter((f) => /\.(jpe?g)$/i.test(f) && !f.startsWith('._')).map((f) => path.join(DIR, f)).sort()
  const p41 = JSON.parse(fs.readFileSync(P41_DUMP, 'utf8'))
  const p41keys = new Set(p41.map((f) => `${f.photo}|${Math.round((f.bbox[0] + f.bbox[2]) / 20)}|${Math.round((f.bbox[1] + f.bbox[3]) / 20)}`))
  const isP41 = (photo, bbox) => p41keys.has(`${path.basename(photo)}|${Math.round((bbox[0] + bbox[2]) / 20)}|${Math.round((bbox[1] + bbox[3]) / 20)}`)
  return { photos, isP41 }
}

async function main() {
  const { photos, isP41 } = loadContext()
  const analysis = await FaceAnalysis.create({ embed: true, qualityScoreMin: THRESH, debugLog: false })
  const rows = []
  for (const p of photos) {
    const img = await decodeRgb(p)
    const dets = await analysis.detectFromImage(img)
    for (const f of dets) {
      const side = Math.max(f.bbox[2] - f.bbox[0], f.bbox[3] - f.bbox[1])
      rows.push({
        photo: path.basename(p),
        x1: Math.round(f.bbox[0]), y1: Math.round(f.bbox[1]),
        x2: Math.round(f.bbox[2]), y2: Math.round(f.bbox[3]),
        side,
        det: f.detScore,
        q: f.qualityScore,
        quality: f.quality,
        embedded: !!f.embedding,
        isP41: isP41(p, f.bbox),
      })
    }
  }
  // Sort: P41 first, then downgraded non-P41, then rest.
  rows.sort((a, b) => (b.isP41 - a.isP41) || (a.embedded - b.embedded) || a.side - b.side)
  console.log(`threshold=${THRESH}  rows=${rows.length}`)
  console.log('photo'.padEnd(12) + 'bbox(x1,y1,x2,y2)'.padEnd(26) + 'side'.padStart(5) + 'det'.padStart(5) + 'eDifFIQA'.padStart(8) + 'quality'.padStart(9) + ' emb  P41')
  for (const r of rows) {
    const bbox = `${r.x1},${r.y1},${r.x2},${r.y2}`
    console.log(r.photo.padEnd(12) + bbox.padEnd(26) + String(r.side).padStart(5) + r.det.toFixed(2).padStart(5) + r.q.toFixed(3).padStart(8) + r.quality.padEnd(9) + (r.embedded ? ' yes ' : ' no  ') + (r.isP41 ? 'YES' : ''))
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
