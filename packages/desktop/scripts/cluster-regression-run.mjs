/**
 * Run the cluster regression against the COMPILED store (dist-main) so we can
 * execute it with plain node (no tsx overhead) after prepare-native electron.
 *
 * Requires: node scripts/prepare-native.mjs electron && npm run build:local
 */
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { PhotoStore } = require('../dist-main/db/store.js')
const { FaceAnalysis } = require('../dist-main/ml/faceAnalysis.js')
const { scanFolder } = require('../dist-main/scanner.js')

const desktopRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = path.join(desktopRoot, 'data')
const dbPath = path.join(dataDir, 'test-cluster-regression.db')
const thumbDir = path.join(dataDir, 'test-cluster-regression-thumbs')

const LFW_ROOT = process.env.LFW_ROOT ?? '/Users/rizkal/scikit_learn_data/lfw_home/lfw_funneled'
const PEOPLE = [
  { dir: 'George_W_Bush', take: 30 },
  { dir: 'Colin_Powell', take: 30 },
  { dir: 'Tony_Blair', take: 30 },
]

function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s }

async function main() {
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(p, { force: true })
  rmSync(thumbDir, { recursive: true, force: true })
  mkdirSync(dataDir, { recursive: true })

  const store = PhotoStore.open(dbPath)
  const analysis = await FaceAnalysis.create()
  for (const { dir, take } of PEOPLE) {
    const full = path.join(LFW_ROOT, dir)
    const files = readdirSync(full).filter((f) => f.endsWith('.jpg')).sort().slice(0, take).map((f) => path.join(full, f))
    console.log(`scanning ${dir}: ${files.length} photos`)
    await scanFolder(store, full, analysis, { thumbDir, files })
  }

  const persons = store.listPersons()
  console.log(`\npersons created: ${persons.length}`)
  let pass = true

  const identityClusters = new Map()
  for (const person of persons) {
    const dirs = new Set()
    for (const p of store.photosForPerson(person.personId)) dirs.add(path.basename(path.dirname(p)))
    if (dirs.size !== 1) continue
    const identity = [...dirs][0]
    if (!identityClusters.has(identity)) identityClusters.set(identity, [])
    identityClusters.get(identity).push(person.personId)
  }
  for (const [identity, clusters] of identityClusters) {
    const ok = clusters.length === 1
    if (!ok) pass = false
    console.log(`  ${identity.padEnd(20)} clusters=${clusters.length} ${ok ? 'OK' : 'OVER-SPLIT!'}`)
  }
  for (const person of persons) {
    const dirs = new Set()
    for (const p of store.photosForPerson(person.personId)) dirs.add(path.basename(path.dirname(p)))
    if (dirs.size > 1) { pass = false; console.log(`  MIXED: ${person.name} spans ${[...dirs].join('+')}`) }
  }
  console.log(pass ? '\n=== REGRESSION PASS ===' : '\n=== REGRESSION FAILED ===')
  store.close()
  process.exit(pass ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
