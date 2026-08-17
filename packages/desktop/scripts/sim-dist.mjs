/**
 * Measure the ACTUAL similarity distribution of faces within a person vs
 * across persons in the real (merged) DB, to pick a defensible
 * CLUSTER_MATCH_THRESHOLD.
 *
 * - intra: sim between faces assigned to the SAME person (should be high)
 * - inter: sim between faces of DIFFERENT persons (should be low)
 * Prints percentiles so we can see the overlap zone.
 */
import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync('/Users/rizkal/Library/Application Support/picly-desktop/data/picly.db', { readOnly: true })
function blobToEmbedding(buf) { return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4) }
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

// Sample up to N persons with >= M faces
const N_PERSONS = 40, M_FACES = 8
const persons = db.prepare(`SELECT person_id, COUNT(*) AS n FROM faces WHERE person_id IS NOT NULL GROUP BY person_id HAVING n >= ? ORDER BY n DESC LIMIT ?`).all(M_FACES, N_PERSONS)
console.log(`sampling ${persons.length} persons with >= ${M_FACES} faces`)

const intra = []
const inter = []
const MAX_PAIRS = 60000
let pairs = 0
for (const p of persons) {
  const embs = db.prepare(`SELECT embedding FROM faces WHERE person_id = ? LIMIT 12`).all(p.person_id).map((r) => blobToEmbedding(r.embedding))
  for (let i = 0; i < embs.length && pairs < MAX_PAIRS; i++) {
    for (let j = i + 1; j < embs.length && pairs < MAX_PAIRS; j++) {
      intra.push(cosine(embs[i], embs[j]))
      pairs++
    }
  }
}
// inter: compare centroid of each person vs a few faces of another person
const centroids = []
for (const p of persons) {
  const embs = db.prepare(`SELECT embedding FROM faces WHERE person_id = ? LIMIT 12`).all(p.person_id).map((r) => blobToEmbedding(r.embedding))
  const c = new Float32Array(embs[0].length)
  for (const e of embs) for (let i = 0; i < c.length; i++) c[i] += e[i]
  for (let i = 0; i < c.length; i++) c[i] /= embs.length
  centroids.push({ id: p.person_id, c, embs })
}
for (let i = 0; i < centroids.length && pairs < MAX_PAIRS * 2; i++) {
  for (let j = i + 1; j < centroids.length && pairs < MAX_PAIRS * 2; j++) {
    for (const e of centroids[j].embs.slice(0, 4)) {
      inter.push(cosine(centroids[i].c, e))
      pairs++
    }
  }
}

function pct(arr, q) {
  const sorted = [...arr].sort((a, b) => a - b)
  return sorted[Math.floor(q * (sorted.length - 1))]
}
console.log(`\nintra pairs: ${intra.length}, inter pairs: ${inter.length}`)
console.log('\npercentile   intra    inter')
for (const q of [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99]) {
  console.log(`  ${(q * 100).toFixed(0).padStart(3)}%    ${pct(intra, q).toFixed(4)}  ${pct(inter, q).toFixed(4)}`)
}
// Overlap zone: where intra p99 < inter p1?
console.log(`\nintra p1  = ${pct(intra, 0.01).toFixed(4)}`)
console.log(`inter p99 = ${pct(inter, 0.99).toFixed(4)}`)
console.log(`intra min = ${Math.min(...intra).toFixed(4)}`)
console.log(`inter max = ${Math.max(...inter).toFixed(4)}`)
