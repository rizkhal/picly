// Mobile scan loop — the equivalent of packages/desktop/src/main/scanner.ts.
//
// One photo at a time (like desktop): decode -> detect (full + adaptive tiles)
// -> quality gate -> conditional embedding -> write to sqlite. When every photo
// is done, run the offline average-linkage HAC (clusterFaces) and persist the
// person assignments.
//
// The heavy inference runs on the JS thread (onnxruntime-react-native is
// synchronous-blocking on the calling thread). This is a deliberate trade-off
// for the first real mobile pipeline: accurate, identical to desktop, but slow.
// If it turns out to block the UI too much, the follow-up is moving the loop
// to a JS Worker (RN Workers run on a separate thread).

import type { DetectedFace } from '../ml';
import { analyzePhoto, decodePhoto } from '../ml';
import { addPhotoWithFaces, applyClusters, type AddFaceInput, type AddPhotoInput } from '../db/store';
import { clusterFaces, type ClusterFace, CLUSTER_LINKAGE_THRESHOLD } from '../db/cluster';

// Re-exported so screens can get oriented decode dims without importing ml directly.
export { decodePhoto };
export type { DetectedFace };

export type ScanStage = 'decoding' | 'detecting' | 'embedding' | 'clustering';

export interface ScanPhotoItem {
  id: string; // media-library asset id (stable unique key)
  uri: string;
  width: number;
  height: number;
}

export interface ScanProgressEvent {
  total: number;
  processed: number;
  currentFile: string | null;
  stage: ScanStage;
  /** Faces found on the CURRENT photo so far (updated during embedding). */
  photoFaces: number;
  /** Errors encountered so far (kept scanning). */
  errors: number;
  cancelled: boolean;
}

export interface ScanResult {
  processed: number;
  photosWithFaces: number;
  totalFaces: number;
  clusters: number;
  errors: number;
  cancelled: boolean;
  elapsedMs: number;
}

export interface ScanOptions {
  onProgress?: (e: ScanProgressEvent) => void;
  shouldCancel?: () => boolean;
}

function emit(
  onProgress: ScanOptions['onProgress'],
  e: Omit<ScanProgressEvent, 'cancelled'>,
): void {
  onProgress?.({ ...e, cancelled: false });
}

/**
 * Scan ONE photo and persist its faces (upsert + replace faces of that photo).
 * Deliberately does NOT touch person assignments or run clustering — a single
 * re-scan must not re-cluster the whole library or wipe existing names.
 */
export async function scanSinglePhoto(photo: ScanPhotoItem): Promise<{ faces: number; error?: string }> {
  try {
    // Decode once so bbox coords + stored dimensions share ONE oriented space
    // (decode applies EXIF rotation; media.width/height may not match it).
    const { detected, width, height } = await analyzePhoto(photo.uri);
    const addFaces: AddFaceInput[] = detected.map((f, i) => ({
      id: `${photo.id}-f${i}-${Date.now().toString(36)}`,
      x1: Math.round(f.bbox[0]),
      y1: Math.round(f.bbox[1]),
      x2: Math.round(f.bbox[2]),
      y2: Math.round(f.bbox[3]),
      embedding: f.embedding,
      faceQuality: f.quality,
      lowQuality: f.lowQuality,
      qualityScore: f.qualityScore,
    }));
    await addPhotoWithFaces(
      {
        id: photo.id,
        assetId: photo.id,
        uri: photo.uri,
        width,
        height,
      } satisfies AddPhotoInput,
      addFaces,
    );
    return { faces: addFaces.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[scan:single] error ${photo.uri}:`, err);
    return { faces: 0, error: msg };
  }
}

/**
 * Scan a list of photos end-to-end. Resolves when done (or cancelled).
 * Faces are stored UNASSIGNED per photo; applyClusters() at the end creates the
 * persons (same order as desktop: insert all -> offline HAC -> assign).
 */
export async function scanPhotos(photos: ScanPhotoItem[], options: ScanOptions = {}): Promise<ScanResult> {
  const { onProgress, shouldCancel } = options;
  const t0 = Date.now();
  let processed = 0;
  let photosWithFaces = 0;
  let totalFaces = 0;
  let errors = 0;
  let cancelled = false;

  for (const photo of photos) {
    if (shouldCancel?.()) {
      cancelled = true;
      break;
    }
    const photoId = photo.id;
    emit(onProgress, {
      total: photos.length,
      processed,
      currentFile: photo.uri,
      stage: 'decoding',
      photoFaces: 0,
      errors,
    });
    try {
      // Decode once; store bbox + dims in the SAME oriented space as the UI.
      const { detected, width, height } = await analyzePhoto(photo.uri);
      emit(onProgress, {
        total: photos.length,
        processed,
        currentFile: photo.uri,
        stage: detected.some((f) => f.embedding) ? 'embedding' : 'detecting',
        photoFaces: detected.length,
        errors,
      });

      const addFaces: AddFaceInput[] = detected.map((f, i) => ({
        id: `${photoId}-f${i}-${Date.now().toString(36)}`,
        x1: Math.round(f.bbox[0]),
        y1: Math.round(f.bbox[1]),
        x2: Math.round(f.bbox[2]),
        y2: Math.round(f.bbox[3]),
        embedding: f.embedding,
        faceQuality: f.quality,
        lowQuality: f.lowQuality,
        qualityScore: f.qualityScore,
      }));
      await addPhotoWithFaces(
        {
          id: photoId,
          assetId: photo.id,
          uri: photo.uri,
          width,
          height,
        } satisfies AddPhotoInput,
        addFaces,
      );
      if (addFaces.length > 0) photosWithFaces += 1;
      totalFaces += addFaces.length;
    } catch (err) {
      errors += 1;
      console.warn(`[scan] error ${photo.uri}:`, err);
    }
    processed += 1;
    emit(onProgress, {
      total: photos.length,
      processed,
      currentFile: null,
      stage: 'detecting',
      photoFaces: 0,
      errors,
    });
  }

  // Offline HAC over every scanned face (same as desktop clusterAllFaces).
  let clusters = 0;
  if (!cancelled && totalFaces > 0) {
    emit(onProgress, {
      total: photos.length,
      processed,
      currentFile: null,
      stage: 'clustering',
      photoFaces: 0,
      errors,
    });
    try {
      const pool = await allClusterFaces();
      const result = clusterFaces(pool, CLUSTER_LINKAGE_THRESHOLD);
      await applyClusters(result);
      clusters = result.length;
    } catch (err) {
      errors += 1;
      console.warn('[scan] clustering error:', err);
    }
  }

  return {
    processed,
    photosWithFaces,
    totalFaces,
    clusters,
    errors,
    cancelled,
    elapsedMs: Date.now() - t0,
  };
}

/** Load every face's embedding + quality for clustering (very_low excluded). */
async function allClusterFaces(): Promise<ClusterFace[]> {
  const { getDb } = await import('../db');
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; embedding: Uint8Array | null; face_quality: string }>(
    `SELECT f.id AS id, f.embedding AS embedding, f.face_quality AS face_quality
     FROM faces f JOIN photos p ON p.id = f.photo_id
     WHERE p.deleted_at IS NULL`,
  );
  const { blobToEmbedding } = await import('../utils/vec');
  return rows.map((r) => ({
    id: r.id,
    embedding: r.embedding ? blobToEmbedding(r.embedding) : null,
    quality: (r.face_quality ?? 'medium') as ClusterFace['quality'],
  }));
}

/**
 * Ensure every scanned face is clustered into persons.
 *
 * Faces scanned via the photo-detail path (scanSinglePhoto) are stored with
 * person_id NULL and never run clustering, so the People tab would stay empty
 * even after a successful scan. This runs the same offline HAC as scanPhotos
 * and is safe to call repeatedly: applyClusters clears person links, recreates
 * persons from clusters, and reassigns members (idempotent).
 *
 * Returns the number of persons created, or 0 when there is nothing to cluster.
 */
export async function ensureClustered(): Promise<number> {
  const { getDb } = await import('../db');
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM faces f
     WHERE f.person_id IS NULL AND f.embedding IS NOT NULL`,
  );
  if (!row || row.n === 0) return 0;
  const pool = await allClusterFaces();
  const result = clusterFaces(pool, CLUSTER_LINKAGE_THRESHOLD);
  if (result.length > 0) {
    await applyClusters(result);
  }
  return result.length;
}
