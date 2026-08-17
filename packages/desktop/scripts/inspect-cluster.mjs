/**
 * For a given ground-truth identity, compare the person clusters that were
 * created for it: average intra-cluster similarity and the similarity of each
 * small cluster's centroid against the main cluster centroid. This tells us
 * whether small clusters are actually the same person (true over-split) or a
 * different person in a group photo (valid separate cluster).
 *
 * Usage: node scripts/inspect-cluster.mjs <identity> <dbPath>
 */
import Database from 'better-sqlite3'

const identity = process.argv[2]
const dbPath = process.argv[3] ?? '/Users/rizkal/Library/Application Support/picly-desktop/data/picly.db'
const db = new Database(dbPath, { readonly: true })

function blobToEmbedding(buf) {
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
}
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

const rows = db.prepare(`
  SELECT p.path, f.person_id, per.name AS pname, f.embedding
  FROM faces f JOIN photos p ON p.id = f.photo_id JOIN persons per ON per.id = f.person_id
  WHERE p.path LIKE ?
`).all('%' + identity + '/%')

if (!rows.length) { console.log('no rows for', identity); process.exit(0) }

const byPerson = new Map()
for (const r of rows) {
  if (!byPerson.has(r.person_id)) byPerson.set(r.person_id, { name: r.pname, embs: [] })
  byPerson.get(r.person_id).embs.push({ emb: blobToEmbedding(r.embedding), path: r.path.split('/').pop() })
}

console.log(`identity: ${identity} (${rows.length} faces, ${byPerson.size} clusters)\n`)
const list = [...byPerson.entries()]
const main = list.sort((a, b) => b[1].embs.length - a[1].embs.length)[0]
console.log(`main cluster: ${main[1].name} (${main[1].embs.length} faces)\n`)

function centroid(embs) {
  const c = new Float32Array(512)
  for (const e of embs) for (let i = 0; i < 512; i++) c[i] += e.emb[i]
  for (let i = 0; i < 512; i++) c[i] /= embs.length
  return c
}
const mainCentroid = centroid(main[1].embs)

for (const [pid, cl] of list) {
  if (pid === main[0]) continue
  // avg sim of each member vs main centroid
  const sims = cl.embs.map((e) => cosine(e.emb, mainCentroid))
  const avg = sims.reduce((a, b) => a + b, 0) / sims.length
  console.log(
    `  ${cl.name.padEnd(10)} (${cl.embs.length} face)  sim_vs_main avg=${avg.toFixed(3)}  per-face: ${sims.map((s) => s.toFixed(3)).join(', ')}`
  )
  for (const e of cl.embs) console.log(`       -> ${e.path}`)
}
