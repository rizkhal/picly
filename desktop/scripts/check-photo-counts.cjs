// Count photos/persons/faces for the psdkp sample folder (Electron ABI).
const path = require('path')
const os = require('os')
const Database = require('../node_modules/better-sqlite3')

const dbPath = path.join(os.homedir(), 'Library/Application Support/Picly/data/picly.db')
const db = new Database(dbPath, { readonly: true })

// All photos in the dataset
const photos = db.prepare(`SELECT id, path FROM photos WHERE path LIKE '%/psdkp-sample-tile/%' ORDER BY path`).all()
console.log('photos in dataset:', photos.length)

// Faces per photo
const facesByPhoto = new Map()
for (const p of photos) {
  const n = db.prepare(`SELECT COUNT(*) c FROM faces WHERE photo_id = ?`).get(p.id).c
  facesByPhoto.set(p.path, n)
}
// persons per photo
const personsByPhoto = new Map()
for (const p of photos) {
  const n = db.prepare(`SELECT COUNT(DISTINCT person_id) c FROM faces WHERE photo_id = ? AND person_id IS NOT NULL`).get(p.id).c
  personsByPhoto.set(p.path, n)
}

for (const p of photos) {
  console.log(`${p.path.split('/').pop().padEnd(24)} faces=${facesByPhoto.get(p.path)} persons=${personsByPhoto.get(p.path)}`)
}
db.close()
