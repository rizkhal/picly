/**
 * Merge duplicate person clusters created by the old snowball over-split.
 *
 * The old matcher seeded a new cluster whenever the best sim was below the
 * threshold (instead of merging into the closest above-threshold cluster),
 * so one identity could end up split across 2+ clusters (e.g. George_W_Bush
 * -> "Person 1351" + "Person 573" with centroid sim 0.996).
 *
 * Strategy (transactional, repeat until stable):
 *   1. Load all person centroids.
 *   2. For each pair with cosine sim >= CLUSTER_MATCH_THRESHOLD, merge the
 *      smaller cluster into the larger (re-assign faces, drop the empty row,
 *      keep the larger cluster's id + name).
 *   3. Recompute the surviving centroid as the mean of all its faces.
 *   4. Repeat until no pair merges.
 *
 * Only touches the persons/faces tables — photos, thumbs and crops are intact.
 *
 * Usage: node scripts/merge-dupes.mjs [dbPath] [--dry-run]
 */
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'

const THRESHOLD = 0.5

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const dbPath = args.find((a) => !a.startsWith('--')) ?? '/Users/rizkal/Library/Application Support/picly-desktop/data/picly.db'
const db = new DatabaseSync(dbPath)

function blobToEmbedding(buf) {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
}
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb))
}
function centroidOf(embs) {
  const c = new Float32Array(embs[0].length)
  for (const e of embs) for (let i = 0; i < c.length; i++) c[i] += e[i]
  for (let i = 0; i < c.length; i++) c[i] /= embs.length
  return c
}

const persons = db.prepare(`SELECT id, name, centroid FROM persons`).all()
  .map((p) => ({ ...p, centroid: p.centroid ? blobToEmbedding(p.centroid) : null }))
const faceCount = (id) => db.prepare(`SELECT COUNT(*) AS n FROM faces WHERE person_id = ?`).get(id).n

console.log(`DB: ${dbPath} (${dryRun ? 'DRY RUN — no writes' : 'LIVE'})`)
console.log(`persons: ${persons.length}, threshold: ${THRESHOLD}`)

let merged = 0, pass = 0
const seen = new Set() // pairs already merged (skip re-scanning)
while (true) {
  pass++
  // Refresh centroids each pass (merge changes counts)
  for (const p of persons) {
    const faces = db.prepare(`SELECT embedding FROM faces WHERE person_id = ?`).all(p.id).map((f) => blobToEmbedding(f.embedding))
    if (faces.length > 0) p.centroid = centroidOf(faces)
    else p.centroid = null
  }
  const alive = persons.filter((p) => p.centroid)
  let mergedThisPass = false

  for (let i = 0; i < alive.length && !mergedThisPass; i++) {
    for (let j = i + 1; j < alive.length && !mergedThisPass; j++) {
      const a = alive[i], b = alive[j]
      if (!a.centroid || !b.centroid) continue
      const pairKey = [a.id, b.id].sort().join('|')
      if (seen.has(pairKey)) continue
      const sim = cosine(a.centroid, b.centroid)
      if (sim < THRESHOLD) continue

      // Merge smaller into larger
      const na = faceCount(a.id), nb = faceCount(b.id)
      const keep = na >= nb ? a : b
      const drop = keep === a ? b : a
      console.log(`  pass ${pass}: merge ${drop.name} (${faceCount(drop.id)}f) into ${keep.name} (${faceCount(keep.id)}f)  sim=${sim.toFixed(4)}`)

      if (!dryRun) {
        db.exec('BEGIN')
        try {
          db.prepare(`UPDATE faces SET person_id = ? WHERE person_id = ?`).run(keep.id, drop.id)
          db.prepare(`DELETE FROM persons WHERE id = ?`).run(drop.id)
          db.exec('COMMIT')
        } catch (e) {
          db.exec('ROLLBACK')
          throw e
        }
        merged++
      } else {
        merged++ // dry-run: count it, don't write
      }
      seen.add(pairKey)
      mergedThisPass = true // restart scan (counts/centroids changed)
    }
  }
  if (!mergedThisPass) break
  if (dryRun) break // dry-run: only report the first wave
}

console.log(`\n${dryRun ? 'DRY RUN would merge' : 'Merged'} ${merged} duplicate clusters across ${pass} pass(es)`)
if (!dryRun) {
  const final = db.prepare(`SELECT COUNT(*) AS n FROM persons`).get().n
  console.log(`final persons: ${final}`)
}
db.close()
