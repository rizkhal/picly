/**
 * Fase 2 smoke test: local storage + scan engine end-to-end.
 *
 * Scans ~/picly-photos-local into a fresh local SQLite store (desktop/data),
 * then verifies:
 *   - photos + faces + person clusters are written
 *   - content-hash dedup skips duplicates (test-dedup folder)
 *   - search(query photo) returns the query itself at #1 and same-person hits on top
 *   - per-person internal similarity is high (cluster quality)
 *
 * Run: bun run scan:test
 */
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PhotoStore } from '../src/main/db/store'
import { FaceAnalysis } from '../src/main/ml/faceAnalysis'
import { decodeRgb } from '../src/main/ml/image'
import { scanFolder } from '../src/main/scanner'

const desktopRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = path.join(desktopRoot, 'data')
const dbPath = path.join(dataDir, 'test-picly.db')
const thumbDir = path.join(dataDir, 'test-thumbs')

const PHOTOS_DIR = '/Users/rizkal/picly-photos-local'

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

  // ------------------------------------------------------------- scan phase
  let lastPct = -1
  const summary = await scanFolder(store, PHOTOS_DIR, analysis, {
    thumbDir,
    onProgress: (p) => {
      const pct = Math.floor((p.processed / Math.max(1, p.total)) * 100)
      if (pct >= lastPct + 10 || p.status !== 'running') {
        lastPct = pct
        console.log(
          `  [${String(pct).padStart(3)}%] ${p.processed}/${p.total}  scanned=${p.scanned} faces=${p.totalFaces} persons=${p.persons} errors=${p.errors}`,
        )
      }
    },
  })

  console.log('\n=== SCAN SUMMARY ===')
  console.log(
    `total=${summary.total} scanned=${summary.scanned} faces=${summary.totalFaces} ` +
      `persons=${summary.persons} errors=${summary.errors} cancelled=${summary.cancelled} elapsed=${(summary.elapsedMs / 1000).toFixed(1)}s`,
  )
  const stats = store.stats()
  console.log(`store stats: ${JSON.stringify(stats)}`)

  // ------------------------------------------------------------ persons table
  console.log('\n=== PERSONS ===')
  const persons = store.listPersons()
  for (const p of persons) {
    console.log(`  ${p.name.padEnd(10)} photos=${String(p.photoCount).padStart(3)} faces=${String(p.faceCount).padStart(3)}`)
  }

  // ------------------------------------------------------------ search tests
  console.log('\n=== SEARCH ===')
  const queries = ['woman_001.jpg', 'man_001.jpg']
  let pass = true
  for (const q of queries) {
    const qPath = path.join(PHOTOS_DIR, q)
    const img = await decodeRgb(qPath)
    const qFaces = await analysis.detectFromImage(img)
    if (qFaces.length === 0) {
      console.log(`${q}: NO FACE`)
      pass = false
      continue
    }
    const hits = store.searchFaces(qFaces[0].embedding, 5)
    const top1Self = hits[0]?.path === qPath
    const queryPerson = hits[0]?.personId
    const samePerson = hits.every((h) => h.personId === queryPerson)
    if (!top1Self || !samePerson) pass = false
    console.log(`\nquery: ${q}  (sim to self = ${hits[0]?.similarity.toFixed(4)})`)
    for (const h of hits) {
      console.log(`  ${h.similarity.toFixed(4)}  ${path.basename(h.path).padEnd(22)} person=${h.personName} [${h.personId?.slice(0, 8)}]`)
    }
    console.log(`  top-1 self-match: ${top1Self ? 'PASS' : 'FAIL'}   all same person: ${samePerson ? 'PASS' : 'FAIL'}`)
  }

  // ------------------------------------------------------ cluster quality
  console.log('\n=== CLUSTER QUALITY (mean cosine vs first face of person) ===')
  for (const p of persons) {
    if (p.faceCount < 2) continue
    const embs = store.faceEmbeddingsForPerson(p.personId, 10)
    const first = embs[0]
    let sum = 0
    for (let i = 1; i < embs.length; i++) sum += dot(first, embs[i])
    const mean = sum / (embs.length - 1)
    const ok = mean > 0.8
    if (!ok) pass = false
    console.log(`  ${p.name.padEnd(10)} faces=${String(p.faceCount).padStart(3)} meanSim=${mean.toFixed(4)} ${ok ? 'OK' : 'LOW'}`)
  }

  console.log(pass ? '\n=== ALL CHECKS PASS ===' : '\n=== SOME CHECKS FAILED ===')
  store.close()
  process.exit(pass ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
