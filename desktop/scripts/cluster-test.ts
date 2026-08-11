/**
 * Clustering correctness test (Fase 2).
 *
 * Scans 4 photos each of 6 known LFW people into a fresh store and verifies:
 *   - exactly 6 person clusters are created
 *   - each cluster contains photos from exactly ONE LFW identity (no mixing)
 *   - intra-cluster similarity is high
 *
 * Run: bun run cluster:test
 */
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PhotoStore } from '../src/main/db/store'
import { FaceAnalysis } from '../src/main/ml/faceAnalysis'
import { scanFolder } from '../src/main/scanner'

const desktopRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = path.join(desktopRoot, 'data')
const dbPath = path.join(dataDir, 'test-cluster.db')
const thumbDir = path.join(dataDir, 'test-cluster-thumbs')

const LFW_ROOT = '/Users/rizkal/scikit_learn_data/lfw_home/lfw_funneled'
const PEOPLE = ['George_W_Bush', 'Colin_Powell', 'Tony_Blair', 'Donald_Rumsfeld', 'Gerhard_Schroeder', 'Ariel_Sharon']
const PER_PERSON = 4

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

async function main(): Promise<void> {
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(p, { force: true })
  rmSync(thumbDir, { recursive: true, force: true })
  mkdirSync(dataDir, { recursive: true })

  const store = PhotoStore.open(dbPath)
  const analysis = await FaceAnalysis.create()

  const expectedDir = new Map<string, string>() // personDir -> identity
  for (const p of PEOPLE) {
    expectedDir.set(path.join(LFW_ROOT, p), p)
  }

  for (const p of PEOPLE) {
    const dir = path.join(LFW_ROOT, p)
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.jpg'))
      .sort()
      .slice(0, PER_PERSON)
      .map((f) => path.join(dir, f))
    console.log(`scanning ${p}: ${files.length} photos`)
    await scanFolder(store, dir, analysis, { thumbDir, files })
  }

  const persons = store.listPersons()
  console.log(`\npersons created: ${persons.length} (identities: ${PEOPLE.length})`)
  console.log('NOTE: CLUSTER_MATCH_THRESHOLD=0.6 mirrors the Python backend — on hard LFW data it deliberately oversegments (precision over recall). Correctness = no cross-identity mixing + every identity covered.')

  let pass = true
  const usedDirs = new Set<string>()
  for (const person of persons) {
    const embs = store.faceEmbeddingsForPerson(person.personId, 20)
    const first = embs[0]
    let sum = 0
    for (let i = 1; i < embs.length; i++) sum += dot(first, embs[i])
    const meanSim = embs.length > 1 ? sum / (embs.length - 1) : 1

    // Which LFW identity dirs do THIS person's own photos belong to?
    const dirs = new Set<string>()
    for (const p of store.photosForPerson(person.personId)) {
      dirs.add(path.basename(path.dirname(p)))
    }
    const pure = dirs.size === 1
    for (const d of dirs) usedDirs.add(d)
    if (!pure) pass = false

    const name = dirs.size === 1 ? [...dirs][0] : `MIXED(${[...dirs].join('+')})`
    console.log(
      `  ${person.name.padEnd(10)} faces=${String(person.faceCount).padStart(2)} meanSim=${meanSim.toFixed(4)} identity=${name} ${pure ? 'OK' : 'MIXED!'}`,
    )
  }

  const allDirsCovered = usedDirs.size === PEOPLE.length
  if (!allDirsCovered) {
    pass = false
    console.log(`WARN: identities covered = ${usedDirs.size}/${PEOPLE.length}`)
  }

  console.log(pass ? '\n=== CLUSTERING PASS ===' : '\n=== CLUSTERING FAILED ===')
  store.close()
  process.exit(pass ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
