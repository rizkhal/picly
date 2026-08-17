#!/usr/bin/env node
/**
 * Distribution of detScore + eDifFIQA for REAL faces (>=64px) in
 * psdkp-sample-tile, to calibrate the composite gate
 * (detScore < X && eqScore < 0.25).
 */
const path = require('node:path')
const fs = require('node:fs')
const { FaceAnalysis } = require('../dist-main/ml/faceAnalysis.js')
const { decodeRgb } = require('../dist-main/ml/image.js')
const { QualityScorer } = require('../dist-main/ml/quality.js')

const MODELS_DIR = process.env.PICLY_MODELS_DIR || path.join(__dirname, '..', 'models')
process.env.PICLY_MODELS_DIR = MODELS_DIR

let analysis
let qualityScorer
const imgCache = new Map()
async function decodeCached(p) {
  if (!imgCache.has(p)) imgCache.set(p, await decodeRgb(p))
  return imgCache.get(p)
}

async function main() {
  analysis = await FaceAnalysis.create({ embed: false })
  qualityScorer = await QualityScorer.create(path.join(MODELS_DIR, 'ediffiqa', 'ediffiqa_t.onnx'))
  qualityScorer = await QualityScorer.create(path.join(MODELS_DIR, 'ediffiqa', 'ediffiqa_t.onnx'))

  const dir = '/Volumes/X/Dataset/psdkp-sample-tile'
  const files = fs.readdirSync(dir).filter((f) => /\.JPG$/i.test(f) && !f.startsWith('._')).sort()
  const rows = []
  for (const fn of files) {
    const img = await decodeCached(path.join(dir, fn))
    const dets = await analysis.detectFromImage(img)
    for (const d of dets) {
      const s = Math.max(d.bbox[2] - d.bbox[0], d.bbox[3] - d.bbox[1])
      if (s < 64) continue
      const eq = await qualityScorer.scoreAligned(
        (await analysis.warpAlignedPublic(img, d.kps)),
      )
      rows.push({ file: fn, size: Math.round(s), score: d.detScore, eq })
    }
  }
  rows.sort((a, b) => a.score - b.score)
  const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))]
  const scores = rows.map((r) => r.score)
  const eqs = rows.map((r) => r.eq)
  console.log(`real >=64px faces: n=${rows.length}`)
  console.log(`detScore  p5=${pct(scores, 5).toFixed(3)} p10=${pct(scores, 10).toFixed(3)} p25=${pct(scores, 25).toFixed(3)} med=${pct(scores, 50).toFixed(3)} p75=${pct(scores, 75).toFixed(3)} p90=${pct(scores, 90).toFixed(3)}`)
  console.log(`eqScore   p5=${pct(eqs, 5).toFixed(3)} p10=${pct(eqs, 10).toFixed(3)} p25=${pct(eqs, 25).toFixed(3)} med=${pct(eqs, 50).toFixed(3)} p75=${pct(eqs, 75).toFixed(3)} p90=${pct(eqs, 90).toFixed(3)}`)
  // How many real faces would the gate (score < 0.6 && eq < 0.25) downgrade?
  for (const gate of [0.5, 0.55, 0.6, 0.65, 0.7]) {
    const hit = rows.filter((r) => r.score < gate && r.eq < 0.25).length
    console.log(`gate detScore<${gate} && eq<0.25 => downgrade ${hit}/${rows.length} real faces (${((hit / rows.length) * 100).toFixed(1)}%)`)
  }
  // Show low-det real faces (would they be wrongly gated?)
  const low = rows.filter((r) => r.score < 0.65).sort((a, b) => a.score - b.score)
  console.log(`\nlow-detScore real faces (<0.65), n=${low.length}:`)
  for (const r of low) {
    const gated = r.score < 0.6 && r.eq < 0.25
    console.log(`  ${r.file.padEnd(32)} score=${r.score.toFixed(3)} size=${String(r.size).padStart(4)} eq=${r.eq.toFixed(3)}${gated ? '  <<< GATED' : ''}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
