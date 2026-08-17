/**
 * Measure peak RSS during a real scan (current pipeline, full-res) on
 * psdkp-sample-tile. Run before/after memory changes to compare.
 *
 * Run:
 *   ORT_LOG_LEVEL=3 ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/measure-scan-memory.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { PhotoStore } = require('../dist-main/db/store.js')
const { FaceAnalysis } = require('../dist-main/ml/faceAnalysis.js')
const { scanFolder } = require('../dist-main/scanner.js')

const DIR = process.env.SAMPLE_DIR || '/Volumes/X/Dataset/psdkp-sample-tile'
const mem = () => Math.round(process.memoryUsage().rss / 1024 / 1024)
let peak = 0
const tick = (label) => {
  const m = mem()
  if (m > peak) peak = m
  console.log(`  [rss=${String(m).padStart(4)}MB peak=${String(peak).padStart(4)}MB] ${label}`)
}

async function main() {
  const dbPath = path.join(os.tmpdir(), `mem-scan-${Date.now()}.db`)
  const thumbDir = path.join(os.tmpdir(), `mem-scan-thumbs-${Date.now()}`)
  fs.mkdirSync(thumbDir, { recursive: true })
  const store = PhotoStore.open(dbPath)
  const analysis = await FaceAnalysis.create({ embed: true })
  tick('FaceAnalysis created')

  const photos = fs.readdirSync(DIR).filter((f) => /\.(jpe?g)$/i.test(f) && !f.startsWith('._')).map((f) => path.join(DIR, f)).sort()
  console.log(`scanning ${photos.length} photos`)
  const t0 = Date.now()
  await scanFolder(store, DIR, analysis, {
    thumbDir,
    files: photos,
    onProgress: (p) => {
      if (p.processed % 4 === 0 || p.processed === p.total) tick(`[${p.processed}/${p.total}] faces=${p.totalFaces}`)
    },
  })
  const dt = ((Date.now() - t0) / 1000).toFixed(1)
  tick(`scan done in ${dt}s`)

  const stats = store.stats()
  console.log(`\nstats: photos=${stats.photos} faces=${stats.faces} persons=${stats.persons}`)
  console.log(`\n=== PEAK RSS: ${peak}MB ===`)

  store.close()
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { fs.rmSync(p, { force: true }) } catch {} }
  try { fs.rmSync(thumbDir, { recursive: true, force: true }) } catch {}
}

main().catch((e) => { console.error(e); process.exit(1) })
