#!/usr/bin/env node
/**
 * Crop faces of a given person from the source photo using bbox coords,
 * write them as JPGs to packages/desktop/data/debug/ for visual inspection.
 * Usage: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/crop-person.cjs <personName|personId>
 */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const sharp = require('sharp')

const db = require('better-sqlite3')(path.join(os.homedir(), 'Library/Application Support/Picly/data/picly.db'), { readonly: true })
const KEY = process.argv[2] || 'Person 41'
const OUT_DIR = path.join(__dirname, '..', 'data', 'debug', 'person-crops')
fs.mkdirSync(OUT_DIR, { recursive: true })

const faces = db.prepare(`
  SELECT f.id, f.x1, f.y1, f.x2, f.y2, f.face_quality, ROUND(f.quality_score,2) qs, p.name, ph.path
  FROM faces f JOIN persons p ON p.id=f.person_id JOIN photos ph ON ph.id=f.photo_id
  WHERE p.name=? OR p.id=? ORDER BY ph.path, f.x1`).all(KEY, KEY)

if (!faces.length) { console.error(`no faces for ${KEY}`); process.exit(1) }

;(async () => {
  for (const f of faces) {
    const pad = Math.round((f.x2 - f.x1) * 0.3)
    const l = Math.max(0, f.x1 - pad), t = Math.max(0, f.y1 - pad)
    const r = f.x2 + pad, b = f.y2 + pad
    const out = path.join(OUT_DIR, `${f.name.replace(/\s+/g, '_')}_${f.id.slice(0, 8)}_${f.face_quality}_${f.qs}.jpg`)
    try {
      await sharp(f.path, { limitInputPixels: false })
        .extract({ left: l, top: t, width: r - l, height: b - t })
        .resize({ width: 300 })
        .jpeg({ quality: 85 })
        .toFile(out)
      console.log(`wrote ${out}  (${f.x2 - f.x1}x${f.y2 - f.y1}px ${f.face_quality} q=${f.qs})`)
    } catch (e) {
      console.error(`FAIL ${f.id}: ${e.message}`)
    }
  }
  db.close()
})()
