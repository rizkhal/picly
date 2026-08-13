/**
 * STEP 4-5 (revised): similarity distribution using data/psdkp-sample-tile only
 * (no identity labels needed).
 *
 * Two measurements, both stratified by face-size bucket:
 *
 *  A) SELF-SCALE STABILITY (same person by construction)
 *     For each large detected face, we downscale the whole photo to several
 *     target sizes, re-detect + re-embed, match the detection back to the
 *     original face (nearest center), and compute cosSim(embed_small, embed_orig).
 *     This shows how much embedding quality degrades as the face gets smaller —
 *     the same person at different scales. Bucket = the (mapped-back) small side.
 *
 *  B) CROSS-FACE (different-person proxy)
 *     cosSim between every pair of distinct faces within the same photo.
 *     Most pairs are different people (no labels, but duplicates are rare after
 *     NMS). Bucket = the smaller side of the pair.
 *
 * Usage:
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/sim-dist-sample.cjs <sampleDir>
 *
 * Output: console tables + JSON to desktop/data/debug/sim-dist-sample.json
 */
const path = require('node:path')
const fs = require('node:fs')
const { FaceAnalysis } = require('../dist-main/ml/faceAnalysis.js')
const { decodeRgb, decodeRgbLetterboxed } = require('../dist-main/ml/image.js')

const dir = process.argv[2]
if (!dir) { console.error('usage: sim-dist-sample.cjs <sample dir>'); process.exit(1) }

const OUT = path.join(__dirname, '..', 'data', 'debug', 'sim-dist-sample.json')
fs.mkdirSync(path.dirname(OUT), { recursive: true })

// Desired synthesized face side per downscale (mapped back to original coords).
const TARGET_SIDES = [100, 64, 48, 32, 24, 16]

const BUCKETS = [
  { name: '>100', min: 100.5, max: Infinity },
  { name: '64-100', min: 64.5, max: 100.5 },
  { name: '32-64', min: 32.5, max: 64.5 },
  { name: '20-32', min: 20.5, max: 32.5 },
  { name: '<20', min: 1, max: 20.5 },
]
const bucketOf = (side) => BUCKETS.find((b) => side >= b.min && side < b.max)?.name ?? '?'

const cosine = (a, b) => {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
const q = (arr, p) => {
  if (arr.length === 0) return NaN
  const s = arr.slice().sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)))]
}
const fmt = (arr) => {
  if (arr.length === 0) return '  n/a'
  return `n=${String(arr.length).padStart(4)}  p10=${q(arr, 0.1).toFixed(3)} p25=${q(arr, 0.25).toFixed(3)} med=${q(arr, 0.5).toFixed(3)} p75=${q(arr, 0.75).toFixed(3)} p90=${q(arr, 0.9).toFixed(3)}`
}
const center = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]
const sideOf = (b) => Math.max(b[2] - b[0], b[3] - b[1])

async function main() {
  const analysis = await FaceAnalysis.create({ embed: true })
  const photos = fs.readdirSync(dir)
    .filter((f) => /\.(jpe?g)$/i.test(f) && !f.startsWith('._'))
    .map((f) => path.join(dir, f))
    .sort()
  console.log(`photos: ${photos.length}`)

  const scalePairs = {}
  const crossPairs = {}
  const buckets = BUCKETS.map((b) => b.name)
  for (const b of buckets) { scalePairs[b] = []; crossPairs[b] = [] }

  let totalRef = 0
  for (const photo of photos) {
    const img = await decodeRgb(photo)
    const faces = await analysis.detectFromImage(img)
    const refs = faces.filter((f) => f.embedding).map((f) => ({
      bbox: f.bbox,
      center: center(f.bbox),
      side: sideOf(f.bbox),
      emb: f.embedding,
    }))
    if (refs.length === 0) continue
    totalRef += refs.length
    console.log(`  ${path.basename(photo)}: ${faces.length} faces, ${refs.length} embedded (refs)`)

    // A) self-scale stability
    for (const t of TARGET_SIDES) {
      const maxDim = Math.max(img.width, img.height)
      // Image target size that makes this face land at ~t px.
      const imgTarget = Math.max(64, Math.min(2048, Math.round((t * maxDim) / 144)))
      const { image: small, detScale } = await decodeRgbLetterboxed(photo, imgTarget)
      const smallDets = await analysis.detectFromImage(small)
      if (smallDets.length === 0) continue
      for (const d of smallDets) {
        if (!d.embedding) continue
        const sideOrig = sideOf(d.bbox) / detScale
        const cOrig = [center(d.bbox)[0] / detScale, center(d.bbox)[1] / detScale]
        // match to nearest reference face
        let best = null
        let bestD = Infinity
        for (const r of refs) {
          const dd = Math.hypot(cOrig[0] - r.center[0], cOrig[1] - r.center[1])
          if (dd < bestD) { bestD = dd; best = r }
        }
        if (!best) continue
        const tol = Math.max(12, best.side * 0.4)
        if (bestD > tol) continue
        const sim = cosine(d.embedding, best.emb)
        const b = bucketOf(sideOrig)
        scalePairs[b]?.push(sim)
      }
    }

    // B) cross-face pairs in the same photo
    for (let i = 0; i < refs.length; i++) {
      for (let j = i + 1; j < refs.length; j++) {
        const sim = cosine(refs[i].emb, refs[j].emb)
        const b = bucketOf(Math.min(refs[i].side, refs[j].side))
        crossPairs[b]?.push(sim)
      }
    }
  }

  console.log(`\nref faces total: ${totalRef}`)
  console.log(`\n=== A) SELF-SCALE STABILITY (same person, downscaled) by size bucket ===`)
  console.log('bucket   | cosSim(original vs downscaled same face)')
  for (const b of buckets) console.log(`${b.padEnd(8)} | ${fmt(scalePairs[b])}`)

  console.log(`\n=== B) CROSS-FACE (different-person proxy, same photo) by size bucket ===`)
  console.log('bucket   | cosSim(pair)')
  for (const b of buckets) console.log(`${b.padEnd(8)} | ${fmt(crossPairs[b])}`)

  fs.writeFileSync(OUT, JSON.stringify({ scalePairs, crossPairs, photos, totalRef }, null, 2))
  console.log(`\nJSON: ${OUT}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
