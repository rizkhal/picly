/**
 * Face-level pairwise sims between the suspicious person pairs, to see WHY a
 * pair with centroid sim > 0.5 (Person 2/26 = 0.514) is still split.
 */
const path = require('node:path')
const os = require('node:os')
const Database = require('better-sqlite3')

const DB = process.env.PICLY_DB || path.join(os.homedir(), 'Library/Application Support/Picly/data/picly.db')

function blobToEmbedding(buf) {
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
}
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  const d = Math.sqrt(na) * Math.sqrt(nb)
  return d > 0 ? dot / d : 0
}

const db = new Database(DB, { readonly: true })
const persons = db.prepare(`SELECT id, name FROM persons`).all()
const nameOf = new Map(persons.map((p) => [p.id, p.name]))

// pairs from the earlier diagnostic
const PAIRS = [
  ['Person 2', 'Person 26'],
  ['Person 17', 'Person 20'],
  ['Person 8', 'Person 19'],
]
const pairIds = PAIRS.map(([a, b]) => {
  const ia = persons.find((p) => p.name === a).id
  const ib = persons.find((p) => p.name === b).id
  return [ia, ib]
})

for (const [ia, ib] of pairIds) {
  const fa = db.prepare(`SELECT id, embedding FROM faces WHERE person_id = ?`).all(ia)
  const fb = db.prepare(`SELECT id, embedding FROM faces WHERE person_id = ?`).all(ib)
  const ea = fa.map((f) => blobToEmbedding(f.embedding))
  const eb = fb.map((f) => blobToEmbedding(f.embedding))

  const sims = []
  for (const x of ea) for (const y of eb) sims.push(cosine(x, y))
  sims.sort((p, q) => q - p)
  const avg = sims.reduce((s, v) => s + v, 0) / sims.length

  console.log(`\n${nameOf.get(ia)} (${fa.length}f) <-> ${nameOf.get(ib)} (${fb.length}f)`)
  console.log(`  face-pair sims: max=${sims[0].toFixed(4)}  p90=${sims[Math.floor(sims.length * 0.1)].toFixed(4)}  mean=${avg.toFixed(4)}  min=${sims[sims.length - 1].toFixed(4)}`)
  console.log(`  max face sim vs centroid sim:`)
  console.log(`    pairs >= 0.50: ${sims.filter((s) => s >= 0.5).length}/${sims.length}`)
  console.log(`    pairs >= 0.45: ${sims.filter((s) => s >= 0.45).length}/${sims.length}`)
}

// Also: how many faces in each person came from the SAME photo (co-occurrence)
console.log(`\n=== CO-OCCURRENCE (faces in same photo, same person) ===`)
for (const [ia, ib] of pairIds) {
  const fa = db.prepare(`
    SELECT f.id, f.photo_id, p.path FROM faces f JOIN photos p ON p.id = f.photo_id WHERE f.person_id = ?
  `).all(ia)
  const fb = db.prepare(`
    SELECT f.id, f.photo_id, p.path FROM faces f JOIN photos p ON p.id = f.photo_id WHERE f.person_id = ?
  `).all(ib)
  const photosA = new Set(fa.map((f) => f.path))
  const photosB = new Set(fb.map((f) => f.path))
  const shared = [...photosA].filter((x) => photosB.has(x))
  console.log(`  ${nameOf.get(ia)} (${fa.length}f, ${photosA.size} photos) <-> ${nameOf.get(ib)} (${fb.length}f, ${photosB.size} photos): shared photos = ${shared.length}`)
  for (const s of shared) console.log(`      SAME PHOTO: ${path.basename(s)}`)
}

db.close()
