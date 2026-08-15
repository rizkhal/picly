/**
 * Migration smoke test — simulate an OLD database (created before the quality
 * columns / person_manual / deleted_at) and verify migrate() upgrades it to
 * SCHEMA_VERSION with the expected columns + user_version.
 *
 * Usage: bun scripts/test-migrate.mjs
 */
import Database from 'better-sqlite3'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { SCHEMA_VERSION, migrate } from '../src/main/db/migrate'

// 1. Build an "old v1" database: base tables only, no quality columns,
//    no deleted_at on photos, no person_manual table.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'picly-migrate-'))
const dbPath = path.join(dir, 'picly.db')
const old = new Database(dbPath)
old.exec(`
CREATE TABLE persons (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT 'Person', centroid BLOB, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE photos (id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, width INTEGER, height INTEGER, thumb_path TEXT, content_hash TEXT UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE faces (id TEXT PRIMARY KEY, photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE, person_id TEXT REFERENCES persons(id) ON DELETE SET NULL, x1 INTEGER NOT NULL, y1 INTEGER NOT NULL, x2 INTEGER NOT NULL, y2 INTEGER NOT NULL, embedding BLOB, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE folders (id TEXT PRIMARY KEY, host_path TEXT NOT NULL UNIQUE, name TEXT NOT NULL, added_at TEXT NOT NULL DEFAULT (datetime('now')), last_scanned_at TEXT);
INSERT INTO persons (id, name) VALUES ('p1', 'Person 1');
INSERT INTO photos (id, path) VALUES ('ph1', '/tmp/old/photo.jpg');
INSERT INTO faces (id, photo_id, x1, y1, x2, y2) VALUES ('f1', 'ph1', 0, 0, 10, 10);
`)
old.pragma('user_version = 1')
old.close()

// 2. Reopen and run the real migrate()
const db = new Database(dbPath)
migrate(db)

const version = db.pragma('user_version', { simple: true })
const facesCols = (db.prepare(`PRAGMA table_info(faces)`).all()).map((c) => c.name)
const photoCols = (db.prepare(`PRAGMA table_info(photos)`).all()).map((c) => c.name)
const hasPersonManual = !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='person_manual'`).get()
const f = db.prepare(`SELECT face_quality, low_quality, quality_score FROM faces WHERE id='f1'`).get()

let ok = true
const check = (label, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`)
  if (!cond) ok = false
}
check(`user_version == ${SCHEMA_VERSION}`, version === SCHEMA_VERSION)
check('faces.face_quality added', facesCols.includes('face_quality'))
check('faces.low_quality added', facesCols.includes('low_quality'))
check('faces.quality_score added', facesCols.includes('quality_score'))
check('photos.deleted_at added', photoCols.includes('deleted_at'))
check('person_manual created', hasPersonManual)
check('old row got defaults', f && f.face_quality === 'medium' && f.low_quality === 0 && f.quality_score === 0.5)
check('existing data preserved', db.prepare(`SELECT COUNT(*) AS n FROM photos`).get().n === 1)

// 3. Idempotency: running migrate() again changes nothing
const versionBefore = db.pragma('user_version', { simple: true })
migrate(db)
check('migrate is idempotent', db.pragma('user_version', { simple: true }) === versionBefore)

db.close()
fs.rmSync(dir, { recursive: true, force: true })
console.log(ok ? '\nALL PASS' : '\nSOME FAILED')
process.exit(ok ? 0 : 1)
