#!/usr/bin/env node
/** Which embedded faces are still very blurry (low eDifFIQA) and where do they live? */
const path = require('node:path')
const os = require('node:os')
const db = require('better-sqlite3')(path.join(os.homedir(), 'Library/Application Support/Picly/data/picly.db'), { readonly: true })

const rows = db
  .prepare(
    `SELECT f.id, f.x1, f.y1, f.x2, f.y2, f.quality_score qs, f.face_quality q, p.name person, ph.path
     FROM faces f LEFT JOIN persons p ON p.id=f.person_id JOIN photos ph ON ph.id=f.photo_id
     WHERE f.embedding IS NOT NULL`,
  )
  .all()

const size = (f) => Math.max(f.x2 - f.x1, f.y2 - f.y1)
console.log(`embedded faces: ${rows.length}`)
console.log(`\n--- embedded faces with eDifFIQA < 0.22 (blur band) ---`)
const low = rows.filter((r) => r.qs < 0.22)
console.log(`count: ${low.length} (${(100 * low.length / rows.length).toFixed(1)}% of embedded)`)
for (const r of low.sort((a, b) => a.qs - b.qs)) {
  console.log(`  ${r.qs.toFixed(3)} size=${size(r)} tier=${r.q} person=${r.person ?? 'unassigned'} ${path.basename(r.path)} [${r.x1},${r.y1}]`)
}

console.log(`\n--- all embedded, sorted by eDifFIQA (lowest 25) ---`)
for (const r of rows.sort((a, b) => a.qs - b.qs).slice(0, 25)) {
  console.log(`  ${r.qs.toFixed(3)} size=${size(r)} tier=${r.q} person=${r.person ?? 'unassigned'} ${path.basename(r.path)} [${r.x1},${r.y1}]`)
}
db.close()
