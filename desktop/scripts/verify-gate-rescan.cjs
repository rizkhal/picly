#!/usr/bin/env node
/**
 * End-to-end verification of the eDifFIQA quality gate on a FRESH database:
 *   fresh DB -> scan all photos (gate ON, default 0.2) -> offline HAC re-cluster
 *   -> audit cluster sizes + whether the Person-41 phantom crops survive.
 *
 * Uses the REAL pipeline (dist-main) exactly like the Electron app does.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/verify-gate-rescan.cjs
 */
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')

const DESKTOP_ROOT = path.join(__dirname, '..')
const MODELS_DIR = process.env.PICLY_MODELS_DIR || path.join(DESKTOP_ROOT, 'models')
process.env.PICLY_MODELS_DIR = MODELS_DIR

const { PhotoStore } = require('../dist-main/db/store.js')
const { FaceAnalysis } = require('../dist-main/ml/faceAnalysis.js')
const { scanFolder } = require('../dist-main/scanner.js')

const DIR = process.env.PSDKP_DIR || '/Volumes/X/Dataset/psdkp-sample-tile'
const DATA_DIR = path.join(os.homedir(), 'Library/Application Support/Picly/data')
const DB_PATH = process.env.PICLY_DB || path.join(DATA_DIR, 'picly.db')

function collectImages(root) {
  const out = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.isFile() && /\.(jpe?g|png)$/i.test(e.name) && !e.name.startsWith('._')) out.push(full)
    }
  }
  walk(root)
  return out
}

async function main() {
  const files = collectImages(DIR).sort()
  console.log(`photos: ${files.length}  dir: ${DIR}`)
  if (files.length === 0) { console.error('no photos'); process.exit(1) }

  // Fresh DB (like a clean install) + fresh thumbs dir.
  fs.rmSync(DB_PATH, { force: true })
  fs.rmSync(DB_PATH + '-wal', { force: true })
  fs.rmSync(DB_PATH + '-shm', { force: true })
  const thumbDir = path.join(DATA_DIR, 'thumbs')
  fs.rmSync(thumbDir, { recursive: true, force: true })

  const store = PhotoStore.open(DB_PATH, { thumbDir })
  const analysis = await FaceAnalysis.create({ embed: true })

  const summary = await scanFolder(store, DIR, analysis, {
    thumbDir,
    onProgress: (p) => {
      if (p.processed % 5 === 0 || p.processed === p.total)
        console.log(`  scan ${p.processed}/${p.total} faces=${p.totalFaces} persons=${p.persons}`)
    },
  })

  console.log(`\nscan summary: photos=${summary.scanned} faces=${summary.totalFaces} persons=${summary.persons} errors=${summary.errors}`)

  // Re-cluster with the same default the app uses at startup.
  const persons = store.clusterAllFaces()
  console.log(`clusterAllFaces -> ${persons} persons`)

  // ---- Audit ----
  const tiers = store.db ? null : null
  void tiers
  const rows = store
    .db.prepare(
      `SELECT f.id, f.face_quality AS q, f.low_quality AS lowq, f.embedding IS NOT NULL AS emb,
              f.x1, f.y1, f.x2, f.y2, ROUND(f.quality_score,3) AS qs, p.name AS person, ph.path
       FROM faces f LEFT JOIN persons p ON p.id = f.person_id JOIN photos ph ON ph.id = f.photo_id`,
    )
    .all()

  const tierCount = {}
  for (const r of rows) tierCount[r.q] = (tierCount[r.q] || 0) + 1
  const embedded = rows.filter((r) => r.emb).length
  const veryLowEmb = rows.filter((r) => r.lowq && r.emb).length
  console.log(`\nfaces: ${rows.length}  embedded: ${embedded}  tiers: ${JSON.stringify(tierCount)}`)
  console.log(`very_low but embedded (should be 0): ${veryLowEmb}`)

  // Person clusters by size (only embedded faces can be in a person).
  const byPerson = new Map()
  for (const r of rows) if (r.person) byPerson.set(r.person, (byPerson.get(r.person) || 0) + 1)
  const sorted = [...byPerson.entries()].sort((a, b) => b[1] - a[1])
  console.log(`\npersons: ${byPerson.size}`)
  console.log('top clusters:')
  for (const [name, n] of sorted.slice(0, 12)) {
    console.log(`  ${name}: ${n} faces`)
  }

  // Phantom P41 crops: very_low faces that still have an embedding, or any
  // cluster whose faces are mostly non-embeddable quality. Also list any face
  // with qs in the P41 band that is still embedded.
  const suspect = rows.filter((r) => r.emb && (r.q === 'very_low' || r.q === 'low') && r.qs < 0.35)
  console.log(`\nsuspicious embedded (low/very_low with qs<0.35): ${suspect.length}`)
  for (const s of suspect.slice(0, 15)) {
    console.log(`  ${s.id.slice(0, 8)} ${s.q} qs=${s.qs} person=${s.person} ${path.basename(s.path)} [${s.x1},${s.y1}] ${s.x2 - s.x1}x${s.y2 - s.y1}`)
  }

  store.close()
  console.log(`\nDB: ${DB_PATH}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
