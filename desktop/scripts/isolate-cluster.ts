/**
 * Isolate: open the live DB via PhotoStore and run clusterAllFaces directly,
 * to see whether the OOM/crash lives in clustering or elsewhere.
 * Usage: bunx tsx scripts/isolate-cluster.ts
 */
import path from 'node:path'
import os from 'node:os'
import { existsSync } from 'node:fs'
import { PhotoStore } from '../src/main/db/store'

const candidates = [
  path.join(os.homedir(), 'Library/Application Support/Picly/data/picly.db'),
  path.join(os.homedir(), 'Library/Application Support/picly-desktop/data/picly.db'),
]
const dbPath = candidates.find(existsSync)
if (!dbPath) { console.error('no db'); process.exit(1) }
console.log('DB:', dbPath)

// Read-only test: open, count faces, run clusterAllFaces against a COPY.
// We must not mutate the live DB, so copy it to a temp file first.
import { copyFileSync } from 'node:fs'
const tmp = `/tmp/picly-cluster-test-${process.pid}.db`
copyFileSync(dbPath, tmp)
console.log('copied to', tmp)

const store = PhotoStore.open(tmp)
try {
  console.log('store opened OK')
  const t0 = Date.now()
  const count = store.clusterAllFaces()
  console.log(`clusterAllFaces done in ${Date.now() - t0}ms — persons: ${count}`)
  const persons = store.listPersons()
  console.log(`listPersons: ${persons.length}`)
} finally {
  store.close()
  console.log('store closed')
}
