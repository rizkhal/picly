#!/usr/bin/env node
/**
 * Verify Person-308 false merge is resolved after the geometry/FP penalty:
 * re-cluster and check A (DSC02286 back-of-head) & B (DSC02490 side profile)
 * land in DIFFERENT persons (previously merged at sim 0.523 >= 0.45).
 */
const path = require('node:path')
const os = require('node:os')
const { PhotoStore } = require('../dist-main/db/store.js')

const store = PhotoStore.open(path.join(os.homedir(), 'Library/Application Support/Picly/data/picly.db'))
const db = store.db

const A_PATH = '/Volumes/X/Dataset/psdkp/DSC02286.JPG'
const B_PATH = '/Volumes/X/Dataset/psdkp/DSC02490.JPG'

function rowFor(pathLike) {
  return db
    .prepare(`SELECT f.id, f.person_id, f.face_quality, f.x1,f.y1,f.x2,f.y2, ph.path
              FROM faces f JOIN photos ph ON ph.id=f.photo_id WHERE ph.path=?`)
    .all(pathLike)
}

async function main() {
  const aRows = rowFor(A_PATH)
  const bRows = rowFor(B_PATH)
  console.log('=== Before re-cluster (DB state) ===')
  for (const r of aRows) console.log(`  A: ${r.id.slice(0, 8)} person=${r.person_id ? String(r.person_id).slice(0, 8) : 'null'} q=${r.face_quality} bbox=${r.x1},${r.y1},${r.x2},${r.y2}`)
  for (const r of bRows) console.log(`  B: ${r.id.slice(0, 8)} person=${r.person_id ? String(r.person_id).slice(0, 8) : 'null'} q=${r.face_quality} bbox=${r.x1},${r.y1},${r.x2},${r.y2}`)

  // Re-cluster with production default 0.45
  const n = store.clusterAllFaces(0.45)
  console.log(`\n=== After clusterAllFaces(0.45) -> ${n} persons ===`)

  const a2 = rowFor(A_PATH)
  const b2 = rowFor(B_PATH)
  for (const r of a2) console.log(`  A: person=${r.person_id ? String(r.person_id).slice(0, 8) : 'null'} q=${r.face_quality}`)
  for (const r of b2) console.log(`  B: person=${r.person_id ? String(r.person_id).slice(0, 8) : 'null'} q=${r.face_quality}`)

  const pa = a2.length ? a2.map((r) => r.person_id).find(Boolean) : null
  const pb = b2.length ? b2.map((r) => r.person_id).find(Boolean) : null
  if (!pa || !pb) {
    console.log('\nRESULT: salah satu tidak punya person (NULL/very_low) — kemungkinan tidak ikut clustering')
  } else if (pa === pb) {
    console.log(`\nRESULT: MASIH MERGE (person ${pa.slice(0, 8)}) — gate belum cukup`)
  } else {
    console.log(`\nRESULT: PISAH ✅  A->${pa.slice(0, 8)}  B->${pb.slice(0, 8)}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
