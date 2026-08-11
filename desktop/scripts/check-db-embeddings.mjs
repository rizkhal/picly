/**
 * Compare embeddings stored in the DB vs freshly computed by the pipeline for
 * the SAME photo. If cosSim ~1.0, storage is fine and the difference comes from
 * face selection (which face gets saved). If cosSim is low, something in the
 * scan/store path corrupts embeddings.
 *
 * Usage: node scripts/check-db-embeddings.mjs <dbPath>
 */
import Database from 'better-sqlite3'
import { FaceAnalysis } from '../src/main/ml/faceAnalysis'

const dbPath = process.argv[2] ?? '/Users/rizkal/Library/Application Support/picly-desktop/data/picly.db'
const db = new Database(dbPath, { readonly: true })

function blobToEmbedding(buf) {
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom > 0 ? dot / denom : 0
}

// Photos with 1 face in DB (unambiguous comparison)
const rows = db.prepare(`
  SELECT p.path, f.embedding, f.x1, f.y1, f.x2, f.y2
  FROM faces f JOIN photos p ON p.id = f.photo_id
  WHERE p.path IN (SELECT p2.path FROM photos p2 JOIN faces f2 ON f2.photo_id = p2.id GROUP BY p2.id HAVING COUNT(f2.id) = 1)
  LIMIT 5
`).all()

const analysis = await FaceAnalysis.create()

console.log('comparing DB-stored vs fresh pipeline embedding for single-face photos:')
let sum = 0, n = 0
for (const r of rows) {
  const stored = blobToEmbedding(r.embedding)
  const fresh = (await analysis.detect(r.path))[0]
  if (!fresh) continue
  const sim = cosine(stored, fresh.embedding)
  sum += sim
  n += 1
  console.log(
    `  ${r.path.split('/').pop()}:  db_bbox=[${r.x1},${r.y1},${r.x2},${r.y2}]  fresh_bbox=[${fresh.bbox.map(v => Math.round(v)).join(',')}]  cosSim=${sim.toFixed(4)}`
  )
}
if (n) console.log(`  avg cosSim = ${(sum / n).toFixed(4)}`)
