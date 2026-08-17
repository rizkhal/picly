#!/usr/bin/env node
/**
 * Compare blur metrics on detections of a photo, to find a metric that
 * separates true faces from flat/blurry non-faces (walls, shoulders, scalp).
 * Prints VoL, gray variance, and edge density per detection; marks faces
 * belonging to a given person (from live DB) to spot the "phantom person".
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/debug-blur.cjs <photo> [personName]
 */
const path = require('node:path')
const os = require('node:os')
const { FaceAnalysis } = require('../dist-main/ml/faceAnalysis.js')
const { decodeRgb, cropRegion } = require('../dist-main/ml/image.js')

const PHOTO = process.argv[2]
const PERSON = process.argv[3] || ''
if (!PHOTO) { console.error('usage: debug-blur.cjs <photo> [personName]'); process.exit(1) }

// Load live DB faces for this photo (to mark which detections belong to PERSON)
let markIds = new Set()
if (PERSON) {
  try {
    const db = require('better-sqlite3')(path.join(os.homedir(), 'Library/Application Support/Picly/data/picly.db'), { readonly: true })
    const rows = db.prepare(`SELECT f.id, f.x1, f.y1, f.x2, f.y2 FROM faces f JOIN persons p ON p.id=f.person_id WHERE p.name=? AND f.photo_id IN (SELECT id FROM photos WHERE path=?)`).all(PERSON, PHOTO)
    markIds = new Set(rows.map((r) => `${r.x1},${r.y1},${r.x2},${r.y2}`))
    db.close()
    console.log(`marking ${markIds.size} faces belonging to "${PERSON}"\n`)
  } catch (e) { console.log(`(no marking: ${e.message})\n`) }
}

function grayVariance(img) {
  const { data, width, height } = img
  let sum = 0, sumSq = 0
  const n = width * height
  for (let i = 0; i < n; i++) {
    const o = i * 3
    const g = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]
    sum += g; sumSq += g * g
  }
  const mean = sum / n
  return sumSq / n - mean * mean
}

function edgeDensity(img) {
  const { data, width, height } = img
  const gray = new Float32Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const o = i * 3
    gray[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]
  }
  let edges = 0, n = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const gx = gray[i + 1] - gray[i - 1]
      const gy = gray[i + width] - gray[i - width]
      if (Math.abs(gx) + Math.abs(gy) > 40) edges++
      n++
    }
  }
  return n ? edges / n : 0
}

async function main() {
  const analysis = await FaceAnalysis.create({ embed: false, blurDowngradeScore: 0 })
  const img = await decodeRgb(PHOTO)
  const faces = await analysis.detectFromImage(img)
  console.log(`detections: ${faces.length}\n`)

  const rows = faces.map((f) => {
    const [x1, y1, x2, y2] = f.bbox.map((v) => Math.round(v))
    const bw = x2 - x1, bh = y2 - y1
    const crop = cropRegion(img, f.bbox)
    const key = `${x1},${y1},${x2},${y2}`
    return {
      key, mark: markIds.has(key),
      bbox: f.bbox.map((v) => Math.round(v)),
      size: Math.round(Math.max(bw, bh)),
      score: f.detScore,
      vol: require('../dist-main/ml/image.js').blurScore(img, f.bbox),
      gvar: grayVariance(crop),
      edge: edgeDensity(crop),
      q: f.quality,
    }
  })
  rows.sort((a, b) => (b.mark - a.mark) || a.gvar - b.gvar)
  console.log('MARK bbox                size  score  VoL     grayVar  edgeDensity  quality')
  for (const r of rows) {
    const m = r.mark ? '>>' : '  '
    console.log(`${m} ${String(r.bbox.join(',')).padEnd(20)} ${String(r.size).padEnd(5)} ${r.score.toFixed(2).padEnd(6)} ${String(Math.round(r.vol)).padEnd(6)} ${String(Math.round(r.gvar)).padEnd(8)} ${r.edge.toFixed(3).padEnd(12)} ${r.q}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
