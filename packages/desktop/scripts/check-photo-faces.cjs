// Inspect faces stored in the DB for one photo (Electron ABI better-sqlite3).
// Usage: ELECTRON_RUN_AS_NODE=1 electron check-photo-faces.cjs <path>
const path = require('path')
const os = require('os')
const Database = require('../node_modules/better-sqlite3')

const photoPath = process.argv[2]
if (!photoPath) { console.error('usage: check-photo-faces.cjs <photoPath>'); process.exit(1) }

const dbPath = path.join(os.homedir(), 'Library/Application Support/Picly/data/picly.db')
const db = new Database(dbPath, { readonly: true })
const rows = db.prepare(`
  SELECT f.id, f.x1, f.y1, f.x2, f.y2, f.quality_score, f.face_quality,
         (f.embedding IS NOT NULL) AS hasEmb, per.name AS person
  FROM faces f JOIN photos p ON p.id = f.photo_id
  LEFT JOIN persons per ON per.id = f.person_id
  WHERE p.path = ?
  ORDER BY f.created_at
`).all(photoPath)
console.log('faces in DB:', rows.length)
for (const r of rows) {
  console.log(`[${r.x1},${r.y1},${r.x2},${r.y2}] q=${Number(r.quality_score).toFixed(3)} tier=${r.face_quality} emb=${r.hasEmb} person=${r.person || '-'}`)
}
db.close()
