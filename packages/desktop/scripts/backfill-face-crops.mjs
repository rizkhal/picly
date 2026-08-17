/**
 * Backfill face crop previews for faces already in the store (scan happened
 * before the crop feature existed, so crop files are missing).
 *
 * Idempotent: writes <thumbDir>/<faceId>.jpg for every face, from the stored
 * bbox + original photo. Skips faces whose crop already exists.
 *
 * Usage: node scripts/backfill-face-crops.mjs [dbPath] [thumbDir]
 */
import Database from 'better-sqlite3'
import { mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { makeFaceCrop, FACE_CROP_SIZE } from '../src/main/thumb'

const dbPath = process.argv[2] ?? '/Users/rizkal/Library/Application Support/picly-desktop/data/picly.db'
const thumbDir = process.argv[3] ?? path.join(path.dirname(dbPath), 'thumbs')
mkdirSync(thumbDir, { recursive: true })

const db = new Database(dbPath, { readonly: true })
const rows = db.prepare(`
  SELECT f.id AS faceId, f.x1, f.y1, f.x2, f.y2, p.path AS photoPath
  FROM faces f JOIN photos p ON p.id = f.photo_id
`).all()

let created = 0, skipped = 0, failed = 0
for (const r of rows) {
  const dest = path.join(thumbDir, `${r.faceId}.jpg`)
  if (existsSync(dest)) { skipped++; continue }
  const ok = await makeFaceCrop(r.photoPath, dest, [r.x1, r.y1, r.x2, r.y2], FACE_CROP_SIZE)
  if (ok) created++
  else failed++
}
console.log(`faces=${rows.length} created=${created} skipped=${skipped} failed=${failed}`)
