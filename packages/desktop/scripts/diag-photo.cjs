/**
 * Debug one photo: dump raw/NMS/gate internals to confirm duplicate-suppression
 * and partial-tile hypotheses. Usage:
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/diag-photo.cjs <photo> [fullThresh tileThresh rePx nmsIou]
 */
const path = require('node:path')
const { FaceAnalysis } = require('../dist-main/ml/faceAnalysis.js')
const { decodeRgb } = require('../dist-main/ml/image.js')

const PHOTO = process.argv[2] || '/Volumes/X/Dataset/psdkp-sample-tile/DSC02166.JPG'
const full = Number(process.argv[3] ?? 0.5)
const tile = Number(process.argv[4] ?? 0.55)
const rePx = Number(process.argv[5] ?? 64)
const nms = Number(process.argv[6] ?? 0.3)

async function main() {
  const analysis = await FaceAnalysis.create({
    fullDetThresh: full,
    tileDetThresh: tile,
    reDetectFacePx: rePx,
    nmsIou: nms,
    minFacePx: 16,
    minFaceScore: 0.3,
    tileOverlap: 0.2,
    embed: false,
    debugLog: true,
  })
  const img = await decodeRgb(PHOTO)
  const t0 = Date.now()
  const faces = await analysis.detectFromImage(img)
  const timings = analysis.lastTimings
  const bd = analysis.lastBreakdown
  console.log(`\n=== ${path.basename(PHOTO)} ===`)
  console.log(`faces=${faces.length}`)
  console.log(`RAW -> NMS -> GATE -> FINAL: ${bd.rawFull}+${bd.rawTile} -> ${bd.afterNms} -> ${bd.afterGate} -> ${bd.final} (rej tiny=${bd.rejectedTiny} score=${bd.rejectedScore} kps=${bd.rejectedKps})`)
  console.log(`time: full=${timings.fullImageMs}ms tile=${timings.tileMs}ms (${timings.tileRuns}) total=${Date.now() - t0}ms`)
}

main().catch((e) => { console.error(e); process.exit(1) })
