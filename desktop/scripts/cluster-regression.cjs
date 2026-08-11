// Electron ABI run of the cluster regression (compiled store + electron ABI native).
// Run: node scripts/prepare-native.mjs electron && ELECTRON_RUN_AS_NODE=1 electron scripts/cluster-regression-run.mjs
const path = require('path')
const fs = require('fs')
const { PhotoStore } = require('../dist-main/db/store.js')
const { FaceAnalysis } = require('../dist-main/ml/faceAnalysis.js')
const { scanFolder } = require('../dist-main/scanner.js')

const desktopRoot = path.join(__dirname, '..')
const dataDir = path.join(desktopRoot, 'data')
const dbPath = path.join(dataDir, 'test-cluster-regression.db')
const thumbDir = path.join(dataDir, 'test-cluster-regression-thumbs')
const LFW_ROOT = process.env.LFW_ROOT || '/Users/rizkal/scikit_learn_data/lfw_home/lfw_funneled'
const PEOPLE = [
  { dir: 'George_W_Bush', take: 30 },
  { dir: 'Colin_Powell', take: 30 },
  { dir: 'Tony_Blair', take: 30 },
]
function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s }

async function main() {
  for (const p of [dbPath, dbPath + '-wal', dbPath + '-shm']) { try { fs.rmSync(p, { force: true }) } catch {} }
  try { fs.rmSync(thumbDir, { recursive: true, force: true }) } catch {}
  fs.mkdirSync(dataDir, { recursive: true })

  const store = PhotoStore.open(dbPath)
  const analysis = await FaceAnalysis.create()
  for (const { dir, take } of PEOPLE) {
    const full = path.join(LFW_ROOT, dir)
    const files = fs.readdirSync(full).filter((f) => f.endsWith('.jpg')).sort().slice(0, take).map((f) => path.join(full, f))
    console.log(`scanning ${dir}: ${files.length} photos`)
    await scanFolder(store, full, analysis, { thumbDir, files })
  }

  const persons = store.listPersons()
  console.log(`\npersons created: ${persons.length}`)
  let pass = true

  // 1. Each identity maps to exactly one MAJOR cluster (>= 60% of faces from
  //    that identity's folder). Background people in group photos create small
  //    clusters too — those are not the identity itself.
  const identityClusters = new Map()
  for (const person of persons) {
    const byDir = new Map()
    for (const p of store.photosForPerson(person.personId)) {
      const d = path.basename(path.dirname(p))
      byDir.set(d, (byDir.get(d) || 0) + 1)
    }
    const total = [...byDir.values()].reduce((a, b) => a + b, 0)
    for (const [identity, n] of byDir) {
      if (n / total >= 0.6) {
        if (!identityClusters.has(identity)) identityClusters.set(identity, [])
        identityClusters.get(identity).push({ personId: person.personId, purity: n / total })
      }
    }
  }
  for (const [identity, clusters] of identityClusters) {
    const ok = clusters.length === 1
    if (!ok) pass = false
    console.log(`  ${identity.padEnd(20)} clusters=${clusters.length} ${ok ? 'OK' : 'OVER-SPLIT!'} ${clusters.map((c) => c.purity.toFixed(2)).join(',')}`)
  }

  // 2. No MIXED person: a person whose faces come from 2+ identities with each
  //    contributing >= 30% (true mixing, not a background guest).
  for (const person of persons) {
    const byDir = new Map()
    for (const p of store.photosForPerson(person.personId)) {
      const d = path.basename(path.dirname(p))
      byDir.set(d, (byDir.get(d) || 0) + 1)
    }
    const total = [...byDir.values()].reduce((a, b) => a + b, 0)
    const significant = [...byDir.entries()].filter(([, n]) => n / total >= 0.3)
    if (significant.length > 1) {
      pass = false
      console.log(`  MIXED: ${person.name} spans ${significant.map(([d, n]) => `${d}(${(100 * n / total).toFixed(0)}%)`).join('+')}`)
    }
  }
  console.log(pass ? '\n=== REGRESSION PASS ===' : '\n=== REGRESSION FAILED ===')
  store.close()
  process.exit(pass ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
