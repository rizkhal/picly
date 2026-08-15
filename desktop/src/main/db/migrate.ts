import type Database from 'better-sqlite3'

/**
 * Versioned SQLite migrations using PRAGMA user_version.
 *
 * SCHEMA (schema.ts) is the idempotent final shape: it runs FIRST on every
 * open (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS), so fresh
 * databases are already at the latest version. For databases created by an
 * older app, SCHEMA's IF NOT EXISTS won't add missing columns to tables that
 * already exist — those columns are added here, one version at a time.
 *
 * Add a new entry to MIGRATIONS whenever the schema changes in a way that
 * needs to transform an existing database. Never edit an applied migration.
 */
export const SCHEMA_VERSION = 2

function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  ddl: string,
): void {
  const cols = new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name),
  )
  if (!cols.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`)
}

export const MIGRATIONS: Array<{ version: number; apply: (db: Database.Database) => void }> = [
  {
    // v1 — baseline. The base tables (persons/photos/faces/folders) are created
    // by SCHEMA's CREATE TABLE IF NOT EXISTS, so there is nothing to transform
    // for databases already at this shape. Exists so user_version is meaningful.
    version: 1,
    apply() {
      /* no-op — baseline shape */
    },
  },
  {
    // v2 — face quality pipeline + soft-delete trash.
    // Older DBs lack the quality columns on faces, the deleted_at soft-delete
    // column on photos, and the person_manual table. Existing rows get the
    // defaults (medium / 0.5) exactly as the ad-hoc migration used to set them.
    version: 2,
    apply(db) {
      addColumnIfMissing(db, 'faces', 'face_quality', `TEXT NOT NULL DEFAULT 'medium'`)
      addColumnIfMissing(db, 'faces', 'low_quality', `INTEGER NOT NULL DEFAULT 0`)
      addColumnIfMissing(db, 'faces', 'quality_score', `REAL NOT NULL DEFAULT 0.5`)
      addColumnIfMissing(db, 'photos', 'deleted_at', `TEXT`)
      db.exec(`CREATE TABLE IF NOT EXISTS person_manual (
        person_id TEXT PRIMARY KEY REFERENCES persons(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`)
    },
  },
]

/**
 * Bring a database up to SCHEMA_VERSION. Runs after SCHEMA (which handles the
 * fresh-database case); for older databases it applies every pending migration
 * in order, then records the resulting version.
 */
export function migrate(db: Database.Database): void {
  let version = db.pragma('user_version', { simple: true }) as number
  for (const m of MIGRATIONS) {
    if (m.version <= version) continue
    db.transaction(() => {
      m.apply(db)
      db.pragma(`user_version = ${m.version}`)
    })()
    version = m.version
  }
}
