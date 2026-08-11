/**
 * Re-scan a SAMPLE of an LFW-style root into the app's real store (same DB the
 * Electron app opens), so the new clustering threshold applies to fresh
 * embeddings.
 *
 * Sampling strategy: take up to `perFolder` photo files from each of the first
 * `maxFolders` identity folders (folder name = ground-truth person). This keeps
 * the scan small while preserving per-identity diversity, which is exactly what
 * exercises clustering.
 *
 * Usage: node scripts/scan-lfw.mjs <lfwRoot> [dbPath] [maxFolders] [perFolder]
 */
import { mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { PhotoStore } from '../src/main/db/store'
import { FaceAnalysis } from '../src/main/ml/faceAnalysis'
import { scanFolder } from '../src/main/scanner'

const root = process.argv[2]
const dbPath = process.argv[3] ?? '/Users/rizkal/Library/Application Support/picly-desktop/data/picly.db'
const maxFolders = Number(process.argv[4] ?? 30)
const perFolder = Number(process.argv[5] ?? 8)
if (!root) {
  console.error('usage: node scripts/scan-lfw.mjs <lfw_funneled dir> [dbPath] [maxFolders] [perFolder]')
  process.exit(1)
}

const thumbDir = path.join(path.dirname(dbPath), 'thumbs')
mkdirSync(thumbDir, { recursive: true })

// Collect sampled files: up to perFolder images from each of maxFolders folders.
const dirs = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .slice(0, maxFolders)
const files = []
for (const d of dirs) {
  const dir = path.join(root, d.name)
  const imgs = readdirSync(dir)
    .filter((f) => /\.(jpe?g|png)$/i.test(f) && !f.startsWith('._'))
    .slice(0, perFolder)
    .map((f) => path.join(dir, f))
  files.push(...imgs)
}
console.log(`sampling ${files.length} files from ${dirs.length} folders (max ${maxFolders} folders x ${perFolder}/folder)`)

const store = PhotoStore.open(dbPath)
const analysis = await FaceAnalysis.create()

let lastPct = -1
const summary = await scanFolder(store, root, analysis, {
  thumbDir,
  files,
  onProgress: (p) => {
    const pct = Math.floor((p.processed / Math.max(1, p.total)) * 100)
    if (pct >= lastPct + 10 || p.status !== 'running') {
      lastPct = pct
      console.log(
        `  [${String(pct).padStart(3)}%] ${p.processed}/${p.total} scanned=${p.scanned} faces=${p.totalFaces} persons=${p.persons} errors=${p.errors}`,
      )
    }
  },
})

console.log('\n=== SCAN SUMMARY ===')
console.log(
  `total=${summary.total} scanned=${summary.scanned} faces=${summary.totalFaces} ` +
    `persons=${summary.persons} errors=${summary.errors} cancelled=${summary.cancelled} elapsed=${(summary.elapsedMs / 1000).toFixed(1)}s`,
)
console.log('store stats:', JSON.stringify(store.stats()))
