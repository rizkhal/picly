// Mobile photo store — async queries over expo-sqlite mirroring the desktop
// PhotoStore read paths (listPersons / listPhotos / faces per photo). The
// scan loop writes through addPhotoWithFaces; screens read through these.

import type { Face, Person, Photo } from '../types';
import { getDb } from './index';

export interface PersonRow {
  id: string;
  name: string;
  centroid: Uint8Array | null;
  avatar_path: string | null;
  face_count: number;
  photo_count: number;
  avg_quality: number;
}

export interface FaceRow {
  id: string;
  photo_id: string;
  person_id: string | null;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  embedding: Uint8Array | null;
  face_quality: string;
  low_quality: number;
  quality_score: number;
  photo_uri: string;
}

const PERSON_SELECT = `
  SELECT p.id, p.name, p.centroid, p.avatar_path,
         COUNT(DISTINCT f.id) AS face_count,
         COUNT(DISTINCT f.photo_id) AS photo_count,
         COALESCE(AVG(f.quality_score), 0) AS avg_quality
  FROM persons p
  LEFT JOIN faces f ON f.person_id = p.id
  WHERE (f.id IS NULL OR f.low_quality = 0)
  GROUP BY p.id
  ORDER BY p.updated_at DESC
`;

/** All persons with aggregate counts. Skips persons whose faces are all low-quality. */
export async function listPersons(): Promise<Person[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<PersonRow>(PERSON_SELECT);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    avatarUri: r.avatar_path ?? '', // fallback: first face thumb (wired in later)
    faceCount: r.face_count,
    photoCount: r.photo_count,
    quality: tierFromScore(r.avg_quality),
  }));
}

/** One person + their faces (with photo uris for thumbnails). */
export async function getPerson(personId: string): Promise<{ person: Person; faces: Face[] } | null> {
  const db = await getDb();
  const person = await db.getFirstAsync<PersonRow>(`${PERSON_SELECT} HAVING p.id = ?`, personId);
  if (!person) return null;

  const faceRows = await db.getAllAsync<FaceRow>(
    `SELECT f.*, ph.uri AS photo_uri
     FROM faces f JOIN photos ph ON ph.id = f.photo_id
     WHERE f.person_id = ? AND f.low_quality = 0
     ORDER BY f.quality_score DESC`,
    personId,
  );

  return {
    person: {
      id: person.id,
      name: person.name,
      avatarUri: person.avatar_path ?? faceRows[0]?.id ? '' : '',
      faceCount: person.face_count,
      photoCount: person.photo_count,
      quality: tierFromScore(person.avg_quality),
    },
    faces: faceRows.map(rowToFace),
  };
}

export interface PhotoRow {
  id: string;
  asset_id: string | null;
  uri: string;
  width: number | null;
  height: number | null;
  face_count: number;
  created_at: string;
}

/** All photos, newest first, with face counts. */
export async function listPhotos(): Promise<Photo[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<PhotoRow>(
    `SELECT ph.id, ph.asset_id, ph.uri, ph.width, ph.height, ph.created_at,
            COUNT(f.id) AS face_count
     FROM photos ph LEFT JOIN faces f ON f.photo_id = ph.id
     WHERE ph.deleted_at IS NULL
     GROUP BY ph.id
     ORDER BY datetime(ph.created_at) DESC`,
  );
  return rows.map((r) => ({
    id: r.id,
    uri: r.uri,
    assetId: r.asset_id ?? undefined,
    width: r.width ?? 0,
    height: r.height ?? 0,
    createdAt: Date.parse(r.created_at) || Date.now(),
    faces: [],
    exists: true,
  }));
}

/** One photo with its faces (bbox + quality), for the detail screen. */
export async function getPhoto(photoId: string): Promise<Photo | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<PhotoRow>(
    `SELECT ph.id, ph.asset_id, ph.uri, ph.width, ph.height, ph.created_at,
            COUNT(f.id) AS face_count
     FROM photos ph LEFT JOIN faces f ON f.photo_id = ph.id
     WHERE ph.id = ? AND ph.deleted_at IS NULL
     GROUP BY ph.id`,
    photoId,
  );
  if (!row) return null;

  const faces = await db.getAllAsync<FaceRow>(
    `SELECT f.*, ph.uri AS photo_uri
     FROM faces f JOIN photos ph ON ph.id = f.photo_id
     WHERE f.photo_id = ? ORDER BY f.x1, f.y1`,
    photoId,
  );

  return {
    id: row.id,
    uri: row.uri,
    assetId: row.asset_id ?? undefined,
    width: row.width ?? 0,
    height: row.height ?? 0,
    createdAt: Date.parse(row.created_at) || Date.now(),
    faces: faces.map(rowToFace),
    exists: true,
  };
}

/** All faces belonging to one person (with photo uri), for the People tab. */
export async function listPersonFaces(personId: string): Promise<Face[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<FaceRow>(
    `SELECT f.*, ph.uri AS photo_uri
     FROM faces f JOIN photos ph ON ph.id = f.photo_id
     WHERE f.person_id = ? ORDER BY f.quality_score DESC`,
    personId,
  );
  return rows.map(rowToFace);
}

/** Unassigned faces (person_id NULL) — shown in the PhotoDetail sheet. */
export async function listUnassignedFaces(): Promise<Face[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<FaceRow>(
    `SELECT f.*, ph.uri AS photo_uri
     FROM faces f JOIN photos ph ON ph.id = f.photo_id
     WHERE f.person_id IS NULL AND f.low_quality = 0
     ORDER BY f.created_at DESC LIMIT 200`,
  );
  return rows.map(rowToFace);
}

// ------------------------------------------------------------------ write

export interface AddPhotoInput {
  id: string;
  assetId?: string;
  uri: string;
  width?: number;
  height?: number;
  albumId?: string;
}

export interface AddFaceInput {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  embedding: Float32Array | null;
  faceQuality: 'high' | 'medium' | 'low' | 'very_low';
  lowQuality: boolean;
  qualityScore: number;
  personId?: string;
}

/** Insert one photo + its faces atomically (the scan loop's write path). */
export async function addPhotoWithFaces(photo: AddPhotoInput, faces: AddFaceInput[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO photos (id, asset_id, uri, width, height, album_id) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET uri = excluded.uri, width = excluded.width, height = excluded.height`,
      photo.id,
      photo.assetId ?? null,
      photo.uri,
      photo.width ?? null,
      photo.height ?? null,
      photo.albumId ?? null,
    );

    await db.runAsync('DELETE FROM faces WHERE photo_id = ?', photo.id);
    for (const f of faces) {
      await db.runAsync(
        `INSERT INTO faces (id, photo_id, person_id, x1, y1, x2, y2, embedding, face_quality, low_quality, quality_score)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        f.id,
        photo.id,
        f.personId ?? null,
        f.x1,
        f.y1,
        f.x2,
        f.y2,
        f.embedding ? new Uint8Array(f.embedding.buffer.slice(f.embedding.byteOffset, f.embedding.byteOffset + f.embedding.byteLength)) : null,
        f.faceQuality,
        f.lowQuality ? 1 : 0,
        f.qualityScore,
      );
    }
  });
}

/** Library summary for the manage-photos page. */
export async function librarySummary(): Promise<{ photos: number; faces: number; persons: number; scannedAt: string | null }> {
  const db = await getDb();
  const photos = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM photos WHERE deleted_at IS NULL');
  const faces = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM faces');
  const persons = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM persons');
  const last = await db.getFirstAsync<{ t: string | null }>('SELECT MAX(created_at) AS t FROM faces');
  return {
    photos: photos?.n ?? 0,
    faces: faces?.n ?? 0,
    persons: persons?.n ?? 0,
    scannedAt: last?.t ?? null,
  };
}

// ------------------------------------------------------------------ utils

function rowToFace(r: FaceRow): Face {
  const w = r.x2 - r.x1;
  const h = r.y2 - r.y1;
  return {
    id: r.id,
    name: null, // resolved via person lookup at render
    status: r.person_id ? 'recognized' : 'unassigned',
    quality: (r.face_quality as Face['quality']) ?? 'medium',
    box: { x: r.x1, y: r.y1, w, h }, // pixel coords — caller normalizes
    thumbnailUri: r.photo_uri,
    personId: r.person_id,
  };
}

function tierFromScore(score: number): Person['quality'] {
  if (score >= 0.6) return 'high';
  if (score >= 0.4) return 'medium';
  if (score >= 0.25) return 'low';
  return 'very_low';
}
