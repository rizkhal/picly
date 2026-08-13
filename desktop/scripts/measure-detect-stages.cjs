/**
 * Measure per-stage latency of detectFromImage on psdkp-sample-tile, to find
 * the real bottleneck (full pass vs tile vs embed).
 *
 * Run:
 *   ORT_LOG_LEVEL=3 ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/measure-detect-stages.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const { FaceAnalysis } = require('../dist-main/ml/faceAnalysis.js')
const { decodeRgb } = require('../dist-main/ml/image.js')

const DIR = process.env.SAMPLE_DIR || '/Volumes/X/Dataset/psdkp-sample-tile'

async function main() {
  const analysis = await FaceAnalysis.create({ embed: true })
  const photos = fs.readdirSync(DIR).filter((f) => /\.(jpe?g)$/i.test(f) && !f.startsWith('._')).map((f) => path.join(DIR, f)).sort()

  const acc = { fullImageMs: 0, tileMs: 0, embedMs: 0, tileRuns: 0, n: 0, faces: 0 }
  for (const p of photos) {
    const img = await decodeRgb(p)
    const faces = await analysis.detectFromImage(img)
    const t = analysis.lastTimings
    acc.fullImageMs += t.fullImageMs
    acc.tileMs += t.tileMs
    acc.embedMs += t.embedMs
    acc.tileRuns += t.tileRuns
    acc.n++
    acc.faces += faces.length
  }
  const n = acc.n
  console.log(`photos=${n}  totalFaces=${acc.faces}`)
  console.log(`\n=== AVG PER PHOTO (ms) ===`)
  console.log(`  full-image pass : ${Math.round(acc.fullImageMs / n)}ms`)
  console.log(`  tiles           : ${Math.round(acc.tileMs / n)}ms (avg ${(acc.tileRuns / n).toFixed(1)} tile-runs)`)
  console.log(`  embed           : ${Math.round(acc.embedMs / n)}ms`)
  console.log(`  total           : ${Math.round((acc.fullImageMs + acc.tileMs + acc.embedMs) / n)}ms`)
}

main().catch((e) => { console.error(e); process.exit(1) })
