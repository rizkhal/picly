/**
 * Fast tile-detection smoke test on a small psdkp sample (3 photos).
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/test-tile-sample.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const Database = require('better-sqlite3')

const ROOT = path.join(__dirname, '..')
const DATA = path.join(ROOT, 'data')
const DB = path.join(DATA, 'test-tile-sample.db')
const THUMBS = path.join(DATA, 'test-tile-sample-thumbs')
const PHOTOS = '/Volumes/XStorage/Projects/picly/data/psdkp-sample-tile'

for (const p of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(p, { force: true })
fs.rmSync(THUMBS, { recursive: true, force: true })
fs.mkdirSync(DATA, { recursive: true })

const { createLocalServices, startScan } = require('../dist-main/local.js')

function blobToEmbedding(buf) {
  const b = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)
}
function cosine(a, b) {
  let d = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  const den = Math.sqrt(na) * Math.sqrt(nb)
  return den > 0 ? d / den : 0
}

async function main() {
  const services = createLocalServices({ dbPath: DB, thumbDir: THUMBS })
  const { store } = services
  let lastPct = -1
  const t0 = Date.now()
  const summary = await startScan(services, PHOTOS, (p) => {
    const pct = Math.floor((p.processed / Math.max(1, p.total)) * 100)
    if (pct >= lastPct + 25 || p.status !== 'running') {
      lastPct = pct
      console.log(`  [${String(pct).padStart(3)}%] ${p.processed}/${p.total} scanned=${p.scanned} faces=${p.totalFaces} persons=${p.persons} errors=${p.errors}`)
    }
  }).done
  console.log(`\nscan: photos=${summary.scanned} faces=${summary.totalFaces} persons=${summary.persons} errors=${summary.errors} elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s`)

  const db = new Database(DB, { readonly: true })
  const persons = db.prepare(`SELECT id, name FROM persons`).all()
  const faces = db.prepare(`SELECT f.person_id AS personId, f.embedding FROM faces f WHERE f.person_id IS NOT NULL`).all()
  const personFaces = new Map()
  for (const f of faces) {
    if (!personFaces.has(f.personId)) personFaces.set(f.personId, [])
    personFaces.get(f.personId).push(blobToEmbedding(f.embedding))
  }
  const centroids = new Map()
  for (const p of persons) {
    const fs2 = personFaces.get(p.id) || []
    if (!fs2.length) continue
    const c = new Float32Array(512)
    for (const e of fs2) for (let i = 0; i < 512; i++) c[i] += e[i]
    for (let i = 0; i < 512; i++) c[i] /= fs2.length
    centroids.set(p.id, c)
  }
  const ids = [...centroids.keys()]
  const pairs = []
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      pairs.push({ a: ids[i], b: ids[j], s: cosine(centroids.get(ids[i]), centroids.get(ids[j])) })
    }
  }
  pairs.sort((x, y) => y.s - x.s)
  console.log(`\npersons: ${persons.length}, face-pairs: ${pairs.length}`)
  console.log(`\n=== TOP-15 CLOSEST (centroid sim) ===`)
  for (const p of pairs.slice(0, 15)) {
    const a = persons.find((x) => x.id === p.a)
    const b = persons.find((x) => x.id === p.b)
    console.log(`  ${p.s.toFixed(4)}  ${a?.name} (${(personFaces.get(p.a) || []).length}f) <-> ${b?.name} (${(personFaces.get(p.b) || []).length}f)`)
  }
  console.log(`\n=== GREY-ZONE (0.45..0.55): ${pairs.filter((p) => p.s >= 0.45 && p.s <= 0.55).length} ===`)
  for (const p of pairs.filter((p) => p.s >= 0.45 && p.s <= 0.55).slice(0, 8)) {
    const a = persons.find((x) => x.id === p.a)
    const b = persons.find((x) => x.id === p.b)
    const ea = personFaces.get(p.a) || []
    const eb = personFaces.get(p.b) || []
    const sims = []
    for (const x of ea) for (const y of eb) sims.push(cosine(x, y))
    sims.sort((x, y) => y - x)
    console.log(`  ${p.s.toFixed(4)}  ${a?.name} (${ea.length}f) <-> ${b?.name} (${eb.length}f)  maxFace=${sims[0]?.toFixed(4)}`)
  }
  db.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
