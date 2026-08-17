#!/usr/bin/env node
/** Crop faces of a few persons post-gate for visual review. */
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const sharp = require('sharp')
const db = require('better-sqlite3')(path.join(os.homedir(), 'Library/Application Support/Picly/data/picly.db'), { readonly: true })
const OUT = path.join(__dirname, '..', 'assets', 'debug', 'verify-postgate')
fs.mkdirSync(OUT, { recursive: true })
const persons = process.argv.slice(2).length ? process.argv.slice(2) : ['Person 41', 'Person 122', 'Person 128']
;(async () => {
  for (const p of persons) {
    const faces = db
      .prepare(
        `SELECT f.id, f.x1, f.y1, f.x2, f.y2, ROUND(f.quality_score,2) qs, ph.path
         FROM faces f JOIN persons p ON p.id=f.person_id JOIN photos ph ON ph.id=f.photo_id
         WHERE p.name=? ORDER BY f.quality_score DESC`,
      )
      .all(p)
    let i = 0
    for (const f of faces) {
      const pad = Math.round((f.x2 - f.x1) * 0.15)
      const out = path.join(OUT, `${p.replace(' ', '')}_${String(i++).padStart(2, '0')}_${f.id.slice(0, 6)}_q${f.qs}.jpg`)
      try {
        await sharp(f.path, { limitInputPixels: false })
          .extract({ left: Math.max(0, f.x1 - pad), top: Math.max(0, f.y1 - pad), width: f.x2 - f.x1 + 2 * pad, height: f.y2 - f.y1 + 2 * pad })
          .resize({ width: 280 })
          .jpeg({ quality: 88 })
          .toFile(out)
        console.log(p, path.basename(f.path), `${f.x2 - f.x1}x${f.y2 - f.y1}`, `qs=${f.qs}`, '->', path.basename(out))
      } catch (e) { console.error('fail', f.id, e.message) }
    }
  }
  db.close()
})().catch((e) => { console.error(e); process.exit(1) })
