// SQLite schema for the mobile local store — mirrors the desktop store
// (desktop/src/main/db/schema.ts) so scan results can be synced 1:1 later.
// Differences from desktop:
//  - photos use `asset_id` (expo-media-library contentUri / PHAsset id) as the
//    stable unique key instead of a filesystem path, plus `uri` for display.
//  - `album_id` links a photo to a media-library album ("folder" on mobile).
//  - embeddings stored as BLOB (512 float32 LE), same as desktop.
//  - bbox as 4 scalar columns, same as desktop.

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS persons (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'Person',
    centroid BLOB,                     -- 512 float32, running average of member embeddings
    avatar_path TEXT,                  -- saved avatar image (person-<id>.jpg in app dir)
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    asset_id TEXT UNIQUE,              -- expo-media-library asset id
    uri TEXT NOT NULL,                 -- file:// uri for display
    width INTEGER,
    height INTEGER,
    album_id TEXT,                     -- media-library album ("folder")
    thumb_path TEXT,
    deleted_at TEXT,                   -- soft-delete: NULL = live, set = trashed
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
    embedding BLOB,                     -- 512 float32 LE; NULL when below embedding threshold (very_low quality)
    face_quality TEXT NOT NULL DEFAULT 'medium',  -- high | medium | low | very_low
    low_quality INTEGER NOT NULL DEFAULT 0,       -- 1 for very_low (below embedding threshold)
    quality_score REAL NOT NULL DEFAULT 0.5,      -- 0..1 continuous quality
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    album_id TEXT UNIQUE,              -- media-library album ("folder" on mobile)
    name TEXT NOT NULL,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_scanned_at TEXT
);

-- Persons the user manually created via merge/split. Re-clustering must never
-- un-merge these — their faces stay where the user put them.
CREATE TABLE IF NOT EXISTS person_manual (
    person_id TEXT PRIMARY KEY REFERENCES persons(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_faces_photo_id ON faces(photo_id);
CREATE INDEX IF NOT EXISTS idx_faces_person_id ON faces(person_id);
CREATE INDEX IF NOT EXISTS idx_photos_created_at ON photos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_photos_asset_id ON photos(asset_id);
`
