/**
 * Regression test for the over-split clustering bug (George_W_Bush 2x).
 *
 * The old matcher seeded a new cluster whenever the best sim was below the
 * threshold (instead of merging into the closest above-threshold cluster),
 * so a single identity with many photos (e.g. 500 LFW shots of one person)
 * could end up split across 2+ clusters with centroid sim ~0.99.
 *
 * This scans a batch of LFW identities and asserts:
 *   - each identity maps to EXACTLY ONE cluster (no split)
 *   - every cluster is pure (photos from a single identity dir)
 *
 * Run: node scripts/prepare-native.mjs node && tsx scripts/cluster-regression.ts
 */
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PhotoStore } from '../src/main/db/store'
import { FaceAnalysis } from '../src/main/ml/faceAnalysis'
import { scanFolder } from '../src/main/scanner'

const desktopRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = path.join(desktopRoot, 'data')
const dbPath = path.join(dataDir, 'test-cluster-regression.db')
const thumbDir = path.join(dataDir, 'test-cluster-regression-thumbs')

const LFW_ROOT = process.env.LFW_ROOT ?? '/Users/rizkal/scikit_learn_data/lfw_home/lfw_funneled'
// Intentionally LARGE samples: the old bug only appears at scale.
const PEOPLE: Array<{ dir: string; take: number }> = [
  { dir: 'George_W_Bush', take: 12 },
  { dir: 'Colin_Powell', take: 12 },
  { dir: 'Tony_Blair', take: 12 },
]

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

  // Scan ALL identities in ONE batch (each scanFolder call processes its own
  // folder, but they interleave into the same store = same clustering state).
  for (const { dir, take } of PEOPLE) {
    const full = path.join(LFW_ROOT, dir)
    const files = readdirSync(full)
      .filter((f) => f.endsWith('.jpg'))
      .sort()
      .slice(0, take)
      .map((f) => path.join(full, f))
    console.log(`scanning ${dir}: ${files.length} photos`)
    await scanFolder(store, full, analysis, { thumbDir, files })
  }

  const persons = store.listPersons()
  console.log(`\npersons created: ${persons.length}`)

  let pass = true

  // 1. Each identity maps to exactly one cluster
  const identityClusters = new Map<string, string[]>()
  for (const person of persons) {
    const dirs = new Set<string>()
    for (const p of store.photosForPerson(person.personId)) dirs.add(path.basename(path.dirname(p)))
    if (dirs.size !== 1) continue
    const identity = [...dirs][0]
    if (!identityClusters.has(identity)) identityClusters.set(identity, [])
    identityClusters.get(identity)!.push(person.personId)
  }
  for (const [identity, clusters] of identityClusters) {
    const ok = clusters.length === 1
    if (!ok) pass = false
    console.log(`  ${identity.padEnd(20)} clusters=${clusters.length} ${ok ? 'OK' : 'OVER-SPLIT!'}`)
  }

  // 2. Cluster purity (no cross-identity mixing)
  for (const person of persons) {
    const dirs = new Set<string>()
    for (const p of store.photosForPerson(person.personId)) dirs.add(path.basename(path.dirname(p)))
    if (dirs.size > 1) {
      pass = false
      console.log(`  MIXED: ${person.name} spans ${[...dirs].join('+')}`)
    }
  }
  console.log(pass ? '\n=== REGRESSION PASS ===' : '\n=== REGRESSION FAILED ===')
  store.close()
  process.exit(pass ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
