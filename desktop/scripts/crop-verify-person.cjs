#!/usr/bin/env node
/** Crop several faces of a person to verify if they're the same person or over-merged. */
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const sharp = require('sharp')
const db = require('better-sqlite3')(path.join(os.homedir(), 'Library/Application Support/Picly/data/picly.db'), { readonly: true })
const PERSON = process.argv[2] || 'Person 41'
const OUT = path.join(__dirname, '..', 'assets', 'debug', 'verify-person')
fs.mkdirSync(OUT, { recursive: true })
const faces = db.prepare(`
  SELECT f.id, f.x1, f.y1, f.x2, f.y2, ROUND(f.quality_score,2) q, ph.path
  FROM faces f JOIN persons p ON p.id=f.person_id JOIN photos ph ON ph.id=f.photo_id
  WHERE p.name=? ORDER BY f.quality_score DESC LIMIT 10`).all(PERSON)
;(async () => {
  for (const f of faces) {
    const pad = Math.round((f.x2 - f.x1) * 0.2)
    const out = path.join(OUT, `${f.id.slice(0, 8)}_${f.q}.jpg`)
    try {
      await sharp(f.path, { limitInputPixels: false })
        .extract({ left: Math.max(0, f.x1 - pad), top: Math.max(0, f.y1 - pad), width: f.x2 - f.x1 + 2 * pad, height: f.y2 - f.y1 + 2 * pad })
        .resize({ width: 250 })
        .jpeg({ quality: 85 })
        .toFile(out)
      console.log(f.path.split('/').pop(), f.x2 - f.x1 + 'x' + (f.y2 - f.y1), 'q=' + f.q, '->', path.basename(out))
    } catch (e) { console.error('fail', f.id, e.message) }
  }
  db.close()
})().catch((e) => { console.error(e); process.exit(1) })
