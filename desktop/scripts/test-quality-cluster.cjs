/**
 * Validate tier-aware clustering: LOW-quality faces must JOIN a strong existing
 * cluster (not seed their own), and VERY_LOW faces must not participate at all.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/test-quality-cluster.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const { PhotoStore } = require('../dist-main/db/store.js')
const { cosine } = require('../dist-main/db/vec.js')

const ROOT = path.join(__dirname, '..')
const DB = path.join(ROOT, 'data', 'test-quality-cluster.db')
for (const p of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(p, { force: true })

function norm(seed) {
  const e = new Float32Array(512)
  for (let i = 0; i < 512; i++) e[i] = Math.sin(seed * (i + 1)) * 0.01
  // Make a deterministic, normalized vector
  let sum = 0
  for (let i = 0; i < 512; i++) sum += e[i] * e[i]
  const n = Math.sqrt(sum)
  for (let i = 0; i < 512; i++) e[i] /= n
  return e
}

function main() {
  const store = PhotoStore.open(DB)
  const embA = norm(1) // person A
  const embB = norm(2) // person B

  // Person A: 2 high-quality faces + 1 LOW-quality face (same identity, strong sim)
  store.addPhotoWithFaces(
    { id: 'p1', path: '/test/a1.jpg' },
    [
      { id: 'f1', photoId: 'p1', x1: 0, y1: 0, x2: 80, y2: 80, embedding: embA, faceQuality: 'high', qualityScore: 0.9, lowQuality: false },
    ],
  )
  store.addPhotoWithFaces(
    { id: 'p2', path: '/test/a2.jpg' },
    [
      { id: 'f2', photoId: 'p2', x1: 0, y1: 0, x2: 80, y2: 80, embedding: embA, faceQuality: 'high', qualityScore: 0.9, lowQuality: false },
    ],
  )
  store.addPhotoWithFaces(
    { id: 'p3', path: '/test/a3.jpg' },
    [
      { id: 'f3', photoId: 'p3', x1: 0, y1: 0, x2: 25, y2: 25, embedding: embA, faceQuality: 'low', qualityScore: 0.4, lowQuality: false },
    ],
  )
  // Person B: 2 high + 1 very_low (embedding null — must NOT cluster)
  store.addPhotoWithFaces(
    { id: 'p4', path: '/test/b1.jpg' },
    [
      { id: 'f4', photoId: 'p4', x1: 0, y1: 0, x2: 80, y2: 80, embedding: embB, faceQuality: 'high', qualityScore: 0.9, lowQuality: false },
      { id: 'f5', photoId: 'p4', x1: 100, y1: 100, x2: 110, y2: 110, embedding: null, faceQuality: 'very_low', qualityScore: 0.2, lowQuality: true },
    ],
  )
  store.addPhotoWithFaces(
    { id: 'p5', path: '/test/b2.jpg' },
    [
      { id: 'f6', photoId: 'p5', x1: 0, y1: 0, x2: 80, y2: 80, embedding: embB, faceQuality: 'high', qualityScore: 0.9, lowQuality: false },
    ],
  )

  const nPersons = store.clusterAllFaces()
  console.log(`clusters: ${nPersons}`)

  const db = require('better-sqlite3')(DB, { readonly: true })
  const assign = db.prepare(`SELECT f.id AS faceId, f.face_quality AS q, per.name AS personName FROM faces f LEFT JOIN persons per ON per.id = f.person_id ORDER BY f.id`).all()
  for (const r of assign) console.log(`  ${r.faceId} [${r.q}] -> ${r.personName}`)
  const persons = db.prepare(`SELECT id, name FROM persons`).all()
  const counts = db.prepare(`SELECT f.person_id AS pid, COUNT(*) AS n FROM faces f WHERE f.person_id IS NOT NULL GROUP BY f.person_id`).all()
  console.log(`\npersons: ${persons.length}`)
  for (const c of counts) console.log(`  ${c.n} faces in ${c.pid}`)
  db.close()
}

main()
