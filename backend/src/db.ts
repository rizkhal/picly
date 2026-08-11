import { Database } from 'bun:sqlite'

/**
 * SQLite storage for auth (users + refresh tokens).
 * DB file lives at /data/picly.db in the container (Docker volume) so it
 * survives restarts; locally defaults to ./data/picly.db.
 */
const DB_PATH = process.env.DB_PATH ?? '/data/picly.db'

export const db = new Database(DB_PATH)

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);
`)

export interface UserRow {
  id: string
  email: string
  password_hash: string
  created_at: string
  updated_at: string
}

export interface RefreshTokenRow {
  id: string
  user_id: string
  token_hash: string
  expires_at: string
  revoked_at: string | null
  created_at: string
}

/** Look up a user by email (for login / register-uniqueness checks). */
export function findUserByEmail(email: string): UserRow | null {
  return db.query('SELECT * FROM users WHERE email = ?').get(email) as UserRow | null
}

export function findUserById(id: string): UserRow | null {
  return db.query('SELECT * FROM users WHERE id = ?').get(id) as UserRow | null
}

export function createUser(id: string, email: string, passwordHash: string): void {
  db.query('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(id, email, passwordHash)
}

export function findRefreshToken(tokenHash: string): RefreshTokenRow | null {
  return db.query('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(tokenHash) as RefreshTokenRow | null
}

export function createRefreshToken(id: string, userId: string, tokenHash: string, expiresAt: string): void {
  db.query(
    'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
  ).run(id, userId, tokenHash, expiresAt)
}

export function revokeRefreshToken(tokenHash: string): void {
  db.query('UPDATE refresh_tokens SET revoked_at = datetime(\'now\') WHERE token_hash = ?').run(tokenHash)
}

export function revokeAllUserRefreshTokens(userId: string): void {
  db.query('UPDATE refresh_tokens SET revoked_at = datetime(\'now\') WHERE user_id = ?').run(userId)
}
