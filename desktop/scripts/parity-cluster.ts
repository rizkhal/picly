/**
 * Clustering parity dump (Fase 2).
 *
 * Scans the same 24 LFW photos (6 people x 4) that scripts/parity_cluster.py
 * processes in the Python backend, then prints "photo personIndex" per face.
 * Compare against the Python output to prove the clustering logic matches.
 *
 * Run: bun run parity:cluster  (writes desktop/data/parity-node.txt)
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PhotoStore } from '../src/main/db/store'
import { FaceAnalysis } from '../src/main/ml/faceAnalysis'
import { scanFolder } from '../src/main/scanner'

const desktopRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = path.join(desktopRoot, 'data')
const dbPath = path.join(dataDir, 'parity-cluster.db')
const thumbDir = path.join(dataDir, 'parity-thumbs')
const LFW_ROOT = '/Users/rizkal/scikit_learn_data/lfw_home/lfw_funneled'
const PEOPLE = ['George_W_Bush', 'Colin_Powell', 'Tony_Blair', 'Donald_Rumsfeld', 'Gerhard_Schroeder', 'Ariel_Sharon']
const PER_PERSON = 4

async function main(): Promise<void> {
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(p, { force: true })
  rmSync(thumbDir, { recursive: true, force: true })
  mkdirSync(dataDir, { recursive: true })

  const store = PhotoStore.open(dbPath)
  const analysis = await FaceAnalysis.create()

  for (const p of PEOPLE) {
    const dir = path.join(LFW_ROOT, p)
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.jpg'))
      .sort()
      .slice(0, PER_PERSON)
      .map((f) => path.join(dir, f))
    await scanFolder(store, dir, analysis, { thumbDir, files })
  }

  // Map person name "Person N" -> N (creation order) and print per photo.
  const orderByName = new Map<string, number>()
  for (const person of store.listPersons()) {
    orderByName.set(person.name, parseInt(person.name.replace('Person ', ''), 10))
  }
  const lines = store.personAssignments().map((a) => `${path.basename(a.path)} ${orderByName.get(a.personName)}`)
  const out = path.join(dataDir, 'parity-node.txt')
  writeFileSync(out, lines.join('\n') + '\n')
  console.log(lines.join('\n'))
  console.log(`\nwrote ${out}`)
  store.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
