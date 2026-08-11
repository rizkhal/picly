"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCHEMA = void 0;
/**
 * SQLite schema for the local desktop store — ported from the Postgres
 * backend (see docs/ml-parity/ and backend/ for provenance). Differences:
 *  - no container_path on folders (desktop is standalone)
 *  - embeddings stored as BLOB (512 float32 LE) instead of pgvector columns;
 *    search happens in JS (see store.ts / vec.ts)
 *  - bbox stored as 4 scalar columns instead of an integer array
 */
exports.SCHEMA = `
CREATE TABLE IF NOT EXISTS persons (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'Person',
    centroid BLOB,                     -- 512 float32, running average of member embeddings
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    width INTEGER,
    height INTEGER,
    thumb_path TEXT,
    content_hash TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS faces (
    id TEXT PRIMARY KEY,
    photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    person_id TEXT REFERENCES persons(id) ON DELETE SET NULL,
    x1 INTEGER NOT NULL,
    y1 INTEGER NOT NULL,
    x2 INTEGER NOT NULL,
    y2 INTEGER NOT NULL,
    embedding BLOB NOT NULL,           -- 512 float32 LE
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    host_path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_scanned_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_faces_photo_id ON faces(photo_id);
CREATE INDEX IF NOT EXISTS idx_faces_person_id ON faces(person_id);
CREATE INDEX IF NOT EXISTS idx_photos_created_at ON photos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_photos_path_prefix ON photos(path);
`;
