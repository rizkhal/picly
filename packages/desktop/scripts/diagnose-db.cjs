/**
 * Read-only diagnostic on the ACTIVE Picly DB: pairwise centroid sims between
 * all persons, plus the faces behind the closest "grey-zone" pairs (the ones
 * a threshold tweak would merge/split). Prints person sizes + face sizes.
 *
 * Usage: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/diagnose-db.cjs
 * (run via bun scripts/diagnose-db.mjs or compile first; see run instructions)
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
const faces = db.prepare(`
  SELECT f.id AS faceId, f.person_id AS personId, f.x1, f.y1, f.x2, f.y2, f.embedding, p.path, p.width, p.height
  FROM faces f JOIN photos p ON p.id = f.photo_id
`).all()

const personFaces = new Map()
for (const f of faces) {
  if (!f.personId) continue
  if (!personFaces.has(f.personId)) personFaces.set(f.personId, [])
  personFaces.get(f.personId).push(f)
}

const centroids = new Map()
for (const p of persons) {
  const fs = personFaces.get(p.id) || []
  if (fs.length === 0) continue
  const c = new Float32Array(512)
  for (const f of fs) { const e = blobToEmbedding(f.embedding); for (let i = 0; i < 512; i++) c[i] += e[i] }
  for (let i = 0; i < 512; i++) c[i] /= fs.length
  centroids.set(p.id, c)
}

// Pairwise centroid sims
const pairs = []
const ids = [...centroids.keys()]
for (let i = 0; i < ids.length; i++) {
  for (let j = i + 1; j < ids.length; j++) {
    pairs.push({ a: ids[i], b: ids[j], s: cosine(centroids.get(ids[i]), centroids.get(ids[j])) })
  }
}
pairs.sort((x, y) => y.s - x.s)

console.log(`DB: ${DB}`)
console.log(`persons: ${persons.length}, faces (assigned): ${faces.length}`)
console.log(`\n=== TOP-30 CLOSEST PERSON PAIRS ===`)
for (const p of pairs.slice(0, 30)) {
  const a = persons.find((x) => x.id === p.a)
  const b = persons.find((x) => x.id === p.b)
  console.log(`  ${p.s.toFixed(4)}  ${a?.name} <-> ${b?.name}`)
}

const grey = pairs.filter((p) => p.s >= 0.45 && p.s <= 0.55)
console.log(`\n=== GREY-ZONE (0.45..0.55): ${grey.length} pairs ===`)
for (const p of grey.slice(0, 10)) {
  const a = persons.find((x) => x.id === p.a)
  const b = persons.find((x) => x.id === p.b)
  const fa = personFaces.get(p.a) || []
  const fb = personFaces.get(p.b) || []
  console.log(`\n${p.s.toFixed(4)}  ${a?.name} (${fa.length} faces) <-> ${b?.name} (${fb.length} faces)`)
  for (const [label, fs] of [['A', fa], ['B', fb]]) {
    for (const f of fs.slice(0, 6)) {
      const w = f.width || 0
      const h = f.height || 0
      const fw = f.x2 - f.x1
      const fh = f.y2 - f.y1
      const pctW = w ? ((fw / w) * 100).toFixed(1) : '?'
      console.log(`   ${label} [${fw}x${fh}px = ${pctW}%w] ${path.basename(f.path)}`)
    }
  }
}

db.close()
