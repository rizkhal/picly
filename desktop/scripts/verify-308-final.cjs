#!/usr/bin/env node
/**
 * Final check on the fresh temp DB: does Person 308's false-merge survive?
 * Also report clusters with mixed photos (potential false merges).
 */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { PhotoStore } = require('../dist-main/db/store.js')

const TEMP_DB = path.join(os.tmpdir(), 'picly-bench-regression.db')
const store = PhotoStore.open(TEMP_DB)
const db = store.db

const A_PATH = '/Volumes/X/Dataset/psdkp/DSC02286.JPG'
const B_PATH = '/Volumes/X/Dataset/psdkp/DSC02490.JPG'

const rows = db
  .prepare(`SELECT f.id, f.person_id, f.face_quality, f.x1,f.y1,f.x2,f.y2, ph.path
            FROM faces f JOIN photos ph ON ph.id=f.photo_id WHERE ph.path=?`)
  .all(A_PATH)

console.log('=== DSC02286 (A back-of-head) faces ===')
for (const r of rows) console.log(`  ${r.id.slice(0, 8)} person=${r.person_id?.slice(0, 8)} q=${r.face_quality} bbox=${r.x1},${r.y1},${r.x2},${r.y2}`)

const rowsB = db
  .prepare(`SELECT f.id, f.person_id, f.face_quality, f.x1,f.y1,f.x2,f.y2, ph.path
            FROM faces f JOIN photos ph ON ph.id=f.photo_id WHERE ph.path=?`)
  .all(B_PATH)
console.log('=== DSC02490 (B side-profile) faces ===')
for (const r of rowsB) console.log(`  ${r.id.slice(0, 8)} person=${r.person_id?.slice(0, 8)} q=${r.face_quality} bbox=${r.x1},${r.y1},${r.x2},${r.y2}`)

// Cross-check: is any face from A and B in the SAME person?
const aPerson = rows.find((r) => r.x1 > 4800)?.person_id
const bPerson = rowsB.find((r) => r.x1 > 5000)?.person_id
console.log(`\nA person=${aPerson?.slice(0, 8)} B person=${bPerson?.slice(0, 8)} => ${aPerson && bPerson && aPerson === bPerson ? 'MASIH MERGE ❌' : 'PISAH ✅'}`)

// Clusters spanning multiple photos (potential identity links / false merges)
console.log('\n=== clusters with >1 photo (top 10 by size) ===')
const clusters = db
  .prepare(`SELECT p.name, COUNT(DISTINCT ph.path) AS nPhotos, COUNT(f.id) AS nFaces
            FROM persons p JOIN faces f ON f.person_id=p.id JOIN photos ph ON ph.id=f.photo_id
            GROUP BY p.id HAVING nPhotos>1 ORDER BY nFaces DESC LIMIT 10`)
  .all()
for (const c of clusters) console.log(`  ${c.name.padEnd(12)} photos=${String(c.nPhotos).padStart(2)} faces=${c.nFaces}`)

console.log('\nTotal persons:', db.prepare('SELECT COUNT(*) AS n FROM persons').get().n)
