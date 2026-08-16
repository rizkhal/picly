#!/usr/bin/env node
/**
 * Re-scan psdkp-sample-tile into the app DB with the NEW pipeline, then
 * re-cluster everything. Keeps the existing psdkp folder intact.
 *
 * Usage:
 *   cd desktop && node scripts/prepare-native.mjs electron && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/rescan-sample.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { PhotoStore } = require('../dist-main/db/store.js')
const { FaceAnalysis } = require('../dist-main/ml/faceAnalysis.js')
const { scanFolder } = require('../dist-main/scanner.js')

const MODELS_DIR = process.env.PICLY_MODELS_DIR || path.join(__dirname, '..', 'models')
process.env.PICLY_MODELS_DIR = MODELS_DIR

const SAMPLE_DIR = '/Volumes/X/Dataset/psdkp-sample-tile'
const TEMP_DB = path.join(os.tmpdir(), 'picly-bench-regression.db')

async function main() {
  for (const p of [TEMP_DB, `${TEMP_DB}-wal`, `${TEMP_DB}-shm`]) fs.rmSync(p, { force: true })
  const store = PhotoStore.open(TEMP_DB)
  const analysis = await FaceAnalysis.create({ embed: true })

  const thumbDir = path.join(os.tmpdir(), 'picly-bench-thumbs')
  fs.rmSync(thumbDir, { recursive: true, force: true })
  const summary = await scanFolder(store, SAMPLE_DIR, analysis, {
    thumbDir,
    onProgress: (p) => {
      if (p.processed % 5 === 0 || p.status !== 'running') {
        console.log(`  [${p.processed}/${p.total}] faces=${p.totalFaces} persons=${p.persons} errors=${p.errors}`)
      }
    },
  })
  console.log(`\nscan: total=${summary.total} scanned=${summary.scanned} faces=${summary.totalFaces} persons=${summary.persons} errors=${summary.errors}`)

  // Re-cluster all with production default
  const n = store.clusterAllFaces(0.45)
  console.log(`re-cluster -> ${n} persons`)

  const stats = store.db.prepare('SELECT face_quality, COUNT(*) AS n FROM faces GROUP BY face_quality').all()
  console.log('tiers:', stats.map((r) => `${r.face_quality}=${r.n}`).join(' '))
  const sing = store.db.prepare(`SELECT COUNT(*) AS n FROM persons p WHERE (SELECT COUNT(*) FROM faces f WHERE f.person_id=p.id)=1`).get()
  const multi = store.db.prepare(`SELECT COUNT(*) AS n FROM persons p WHERE (SELECT COUNT(*) FROM faces f WHERE f.person_id=p.id)>1`).get()
  console.log(`persons: singleton=${sing.n} multi=${multi.n}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
