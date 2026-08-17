// Thin async wrapper around expo-sqlite. The scan loop and screens talk to
// this module only — never to the raw SQLiteDatabase directly.

import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { SCHEMA } from './schema';

const DB_NAME = 'picly.db';

let dbPromise: Promise<SQLiteDatabase> | null = null;

/** Opens (once) and migrates the local store. Idempotent. */
export function getDb(): Promise<SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = openDatabaseAsync(DB_NAME).then(async (db) => {
      await db.execAsync('PRAGMA journal_mode = WAL;');
      await db.execAsync('PRAGMA foreign_keys = ON;');
      await db.execAsync(SCHEMA);
      return db;
    });
  }
  return dbPromise;
}

/** Closes and resets the cached handle (used by tests / app teardown). */
export async function closeDb(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    await db.closeAsync();
    dbPromise = null;
  }
}
