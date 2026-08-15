#!/usr/bin/env node
/**
 * Benchmark the eDifFIQA quality gate end-to-end through the REAL Node pipeline
 * (dist-main) on data/psdkp-sample-tile:
 *
 *   1. detects + embeds every photo with qualityScoreMin = 0 (gate disabled)
 *   2. matches detections against the Person-41 ground truth (from the PoC
 *      dump) by photo + bbox-center, prints each P41 face's eDifFIQA score
 *   3. re-scans with qualityScoreMin = 0.20 and 0.25 (gate enabled)
 *   4. reports tier/embedding counts, what fraction of P41 faces are no longer
 *      embedded, and how many otherwise-good faces (size>=64, det>=0.7) would
 *      be wrongly downgraded
 *
 * Usage:
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/bench-ediffiqa-gate.cjs [threshold1 threshold2 ...]
 */
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { FaceAnalysis } = require('../dist-main/ml/faceAnalysis.js')
const { decodeRgb } = require('../dist-main/ml/image.js')

const DIR = process.env.PSDKP_DIR || '/Volumes/X/Dataset/psdkp-sample-tile'
const P41_DUMP = '/tmp/picly-bench/person41-kps.json'
const THRESHOLDS = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n))
const SWEEP = THRESHOLDS.length ? THRESHOLDS : [0, 0.2, 0.25]

// Point the pipeline at the project's models (desktop/models) instead of the
// default ~/.insightface/models so the new ediffiqa model is found.
const DESKTOP_ROOT = path.join(__dirname, '..')
const MODELS_DIR = process.env.PICLY_MODELS_DIR || path.join(DESKTOP_ROOT, 'models')
process.env.PICLY_MODELS_DIR = MODELS_DIR

function loadContext() {
  const photos = fs.readdirSync(DIR).filter((f) => /.(jpe?g)$/i.test(f) && !f.startsWith('._')).map((f) => path.join(DIR, f)).sort()
  const p41 = JSON.parse(fs.readFileSync(P41_DUMP, 'utf8'))
  const p41keys = new Set(p41.map((f) => `${f.photo}|${Math.round((f.bbox[0] + f.bbox[2]) / 20)}|${Math.round((f.bbox[1] + f.bbox[3]) / 20)}`))
  const isP41 = (photo, bbox) => {
    const base = path.basename(photo)
    const key = `${base}|${Math.round((bbox[0] + bbox[2]) / 20)}|${Math.round((bbox[1] + bbox[3]) / 20)}`
    return p41keys.has(key)
  }
  return { photos, p41, isP41 }
}

async function runScan(analysis, photos) {
  const faces = []
  const totals = { rawFull: 0, rawTile: 0, afterNms: 0, afterGate: 0, downgraded: 0 }
  for (const p of photos) {
    const img = await decodeRgb(p)
    const dets = await analysis.detectFromImage(img)
    const b = analysis.lastBreakdown
    if (b) {
      totals.rawFull += b.rawFull
      totals.rawTile += b.rawTile
      totals.afterNms += b.afterNms
      totals.afterGate += b.afterGate
      totals.downgraded += b.qualityDowngraded
    }
    for (const f of dets) {
      faces.push({ photo: p, bbox: f.bbox, kps: f.kps, detScore: f.detScore, embedding: f.embedding, quality: f.quality, qualityScore: f.qualityScore })
    }
  }
  return { faces, totals }
}

async function main() {
  const { photos, p41, isP41 } = loadContext()
  console.log(`photos: ${photos.length}  Person-41 GT: ${p41.length} faces\n`)

  for (const t of SWEEP) {
    const analysis = await FaceAnalysis.create({ embed: true, qualityScoreMin: t, debugLog: false })
    const { faces, totals } = await runScan(analysis, photos)
    const embedded = faces.filter((f) => f.embedding).length
    const tiers = { high: 0, medium: 0, low: 0, very_low: 0 }
    for (const f of faces) tiers[f.quality] += 1
    const p41faces = t === 0 ? [] : faces.filter((f) => isP41(f.photo, f.bbox))
    const p41Embedded = p41faces.filter((f) => f.embedding).length
    // "Good" faces = not P41, size >= 64, detScore >= 0.7 — should NOT be downgraded.
    const good = faces.filter((f) => !isP41(f.photo, f.bbox))
    const goodTotal = good.filter((f) => Math.max(f.bbox[2] - f.bbox[0], f.bbox[3] - f.bbox[1]) >= 64 && f.detScore >= 0.7).length
    const goodDowngraded = good.filter((f) => Math.max(f.bbox[2] - f.bbox[0], f.bbox[3] - f.bbox[1]) >= 64 && f.detScore >= 0.7 && f.embedding === null).length
    console.log(`--- threshold=${t}${t === 0 ? ' (gate OFF)' : ' (gate ON)'} ---`)
    console.log(`  detections: ${faces.length}  embedded: ${embedded}  tiers: high=${tiers.high} med=${tiers.medium} low=${tiers.low} very_low=${tiers.very_low}`)
    console.log(`  P41: ${p41faces.length} faces detected, ${p41Embedded} still embedded (${(100 - (100 * p41Embedded) / Math.max(1, p41faces.length)).toFixed(0)}% dropped)`)
    console.log(`  breakdown: rawFull=${totals.rawFull} rawTile=${totals.rawTile} afterNMS=${totals.afterNms} afterGate=${totals.afterGate} downgraded=${totals.downgraded}`)
    console.log(`  good faces wrongly downgraded: ${goodDowngraded}/${goodTotal}\n`)
    if (t === 0) {
      console.log('  P41 scores (gate off):')
      for (const f of p41faces) {
        const size = Math.round(Math.max(f.bbox[2] - f.bbox[0], f.bbox[3] - f.bbox[1]))
        console.log(`    ${path.basename(f.photo)} [${Math.round(f.bbox[0])},${Math.round(f.bbox[1])}] size=${size} det=${f.detScore.toFixed(2)} eDifFIQA=${f.qualityScore.toFixed(3)}`)
      }
      console.log('')
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
