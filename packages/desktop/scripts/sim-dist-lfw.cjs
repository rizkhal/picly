/**
 * STEP 4-5: Same-person vs different-person cosine-similarity distribution,
 * stratified by face size bucket, using LFW funneled (folder name = identity).
 *
 * For each identity we take up to N photos, detect faces, and take the LARGEST
 * face (the subject, per LFW convention). We also record each face's side
 * (max bbox dim) so we can stratify similarity by size.
 *
 * Usage:
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/sim-dist-lfw.cjs <lfwRoot> [maxIdentities] [photosPerIdentity]
 *
 * Output: console table + JSON to packages/desktop/data/debug/sim-dist-lfw.json
 */
const path = require('node:path')
const fs = require('node:fs')
const { FaceAnalysis } = require('../dist-main/ml/faceAnalysis.js')
const { decodeRgb, decodeRgbLetterboxed } = require('../dist-main/ml/image.js')

const root = process.argv[2]
if (!root) { console.error('usage: sim-dist-lfw.cjs <lfw_funneled dir> [maxIdentities] [photosPerIdentity]'); process.exit(1) }
const MAX_IDENTITIES = Number(process.argv[3] ?? 20)
const PHOTOS_PER = Number(process.argv[4] ?? 4)

const OUT = path.join(__dirname, '..', 'data', 'debug', 'sim-dist-lfw.json')
fs.mkdirSync(path.dirname(OUT), { recursive: true })

// Contiguous size buckets (same bands as the quality tiers, boundaries at .5)
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
function readDir(dir) { try { return fs.readdirSync(dir, { withFileTypes: true }) } catch { return [] } }

async function main() {
  const analysis = await FaceAnalysis.create({ embed: true })
  // Pick identities that actually have >= PHOTOS_PER usable photos (LFW has many
  // single-photo identities). Sorting by photo count desc gives us dense subjects.
  const candidates = readDir(root).filter((d) => d.isDirectory()).map((d) => d.name)
  const dense = candidates
    .map((name) => ({ name, n: readDir(path.join(root, name)).filter((f) => f.isFile() && /\.(jpe?g)$/i.test(f.name) && !f.name.startsWith('._')).length }))
    .filter((c) => c.n >= PHOTOS_PER)
    .sort((a, b) => b.n - a.n)
  const identities = dense.slice(0, MAX_IDENTITIES).map((c) => c.name)
  console.log(`using ${identities.length}/${candidates.length} identities with >=${PHOTOS_PER} photos`)

  // Downscale targets (side length) to synthesize per-size-bucket samples from
  // the same large LFW face. Each target embeds the same subject at a smaller
  // face size, so we can measure embedding degradation vs scale.
  const TARGETS = [144, 96, 64, 48, 32, 24, 16]

  // For each identity: list of { side, emb }
  const perPerson = []
  for (const name of identities) {
    const dir = path.join(root, name)
    const photos = readDir(dir)
      .filter((f) => f.isFile() && /\.(jpe?g)$/i.test(f.name) && !f.name.startsWith('._'))
      .slice(0, PHOTOS_PER)
      .map((f) => path.join(dir, f.name))
    const faces = []
    for (const p of photos) {
      try {
        const img = await decodeRgb(p)
        const dets = await analysis.detectFromImage(img)
        if (dets.length === 0) continue
        // largest face = subject
        dets.sort((a, b) => (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1]) - (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]))
        const f = dets[0]
        if (!f.embedding) continue
        faces.push({ side: Math.max(f.bbox[2] - f.bbox[0], f.bbox[3] - f.bbox[1]), emb: f.embedding })
        // Synthesized smaller versions via downscale of the whole image, then
        // re-detect+embed on the smaller image.
        for (const t of TARGETS) {
          const { image: small, detScale } = await decodeRgbLetterboxed(p, t)
          const smallDets = await analysis.detectFromImage(small)
          if (smallDets.length === 0) continue
          smallDets.sort((a, b) => (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1]) - (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]))
          const sf = smallDets[0]
          if (!sf.embedding) continue
          // map back to original scale: side_orig = side_small / detScale
          const sideOrig = Math.max(sf.bbox[2] - sf.bbox[0], sf.bbox[3] - sf.bbox[1]) / detScale
          faces.push({ side: sideOrig, emb: sf.embedding, synthesized: true })
        }
      } catch (e) { console.error(`  skip ${p}: ${e.message}`) }
    }
    if (faces.length >= 2) perPerson.push({ name, faces })
    process.stdout.write(`\r  ${perPerson.length}/${identities.length} identities with >=2 faces`)
  }
  console.log('')

  // ---- Pairwise similarities, stratified ----
  const buckets = ['>100', '64-100', '32-64', '20-32', '<20']
  const posByBucket = Object.fromEntries(buckets.map((b) => [b, []]))
  const negByBucket = Object.fromEntries(buckets.map((b) => [b, []]))
  for (const p of perPerson) {
    const fs2 = p.faces
    for (let i = 0; i < fs2.length; i++) {
      for (let j = i + 1; j < fs2.length; j++) {
        const b = bucketOf(Math.min(fs2[i].side, fs2[j].side))
        posByBucket[b]?.push(cosine(fs2[i].emb, fs2[j].emb))
      }
    }
  }
  for (let a = 0; a < perPerson.length; a++) {
    for (let b = a + 1; b < perPerson.length; b++) {
      const ea = perPerson[a].faces
      const eb = perPerson[b].faces
      for (const fa of ea) for (const fb of eb) {
        const bucket = bucketOf(Math.min(fa.side, fb.side))
        negByBucket[bucket]?.push(cosine(fa.emb, fb.emb))
      }
    }
  }

  const fmt = (arr) => {
    if (arr.length === 0) return '  n/a'
    const n = arr.length
    return `n=${String(n).padStart(4)}  p10=${q(arr, 0.1).toFixed(3)} p25=${q(arr, 0.25).toFixed(3)} med=${q(arr, 0.5).toFixed(3)} p75=${q(arr, 0.75).toFixed(3)} p90=${q(arr, 0.9).toFixed(3)}`
  }

  console.log(`\n=== SAME-PERSON similarity by size bucket (n identities=${perPerson.length}) ===`)
  console.log('bucket   | pos')
  for (const b of buckets) console.log(`${b.padEnd(8)} | ${fmt(posByBucket[b])}`)
  console.log(`\n=== DIFFERENT-PERSON similarity by size bucket ===`)
  console.log('bucket   | neg')
  for (const b of buckets) console.log(`${b.padEnd(8)} | ${fmt(negByBucket[b])}`)

  // ---- Overall (all sizes) ----
  const allPos = Object.values(posByBucket).flat()
  const allNeg = Object.values(negByBucket).flat()
  console.log(`\n=== OVERALL ===`)
  console.log(`pos ${fmt(allPos)}`)
  console.log(`neg ${fmt(allNeg)}`)

  fs.writeFileSync(OUT, JSON.stringify({ posByBucket, negByBucket, allPos, allNeg, perPerson: perPerson.map((p) => ({ name: p.name, sides: p.faces.map((f) => Math.round(f.side)) })) }, null, 2))
  console.log(`\nJSON: ${OUT}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
