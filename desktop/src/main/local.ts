/**
 * Local services entry point for the Electron main process.
 *
 * Compiled to CJS (tsconfig.local.json -> dist-main/local.js) and required by
 * main.cjs. Owns the local SQLite store + lazily-loaded face pipeline, and
 * exposes scan/search orchestration that the IPC handlers call.
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { PhotoStore, type SearchHit } from './db/store'
import { FaceAnalysis } from './ml/faceAnalysis'
import { decodeRgb } from './ml/image'
import { scanFolder, type ScanProgress, type ScanSummary } from './scanner'

export interface LocalConfig {
  dbPath: string
  thumbDir: string
  /** Drop faces with eDifFIQA below this at scan time ("better absent than
   *  blurry"). 0 keeps every detection. */
  minFaceQuality?: number
}

export interface LocalServices {
  config: LocalConfig
  store: PhotoStore
  /** Lazily-loaded face pipeline (model load takes seconds; first use only). */
  getAnalysis(): Promise<FaceAnalysis>
}

export function createLocalServices(config: LocalConfig): LocalServices {
  mkdirSync(path.dirname(config.dbPath), { recursive: true })
  mkdirSync(config.thumbDir, { recursive: true })
  const store = PhotoStore.open(config.dbPath, { thumbDir: config.thumbDir })
  // One-time housekeeping on startup: drop abandoned persons + orphan thumb
  // files (leftovers from earlier deletes that predate thumb cleanup).
  store.cleanupOrphans()
  // Re-cluster all faces with the current HAC algorithm. Clustering only runs
  // at the end of a scan, so without this an algorithm upgrade would never
  // re-assign faces that were clustered by an older version.
  store.clusterAllFaces()
  let analysisPromise: Promise<FaceAnalysis> | null = null
  return {
    config,
    store,
    getAnalysis: () => (analysisPromise ??= FaceAnalysis.create()),
  }
}

export interface ScanHandle {
  scanId: string
  cancel(): void
  done: Promise<ScanSummary>
}

/**
 * Start a folder scan; progress is streamed via onProgress.
 * mode 'add' = only index NEW files (resume-friendly).
 * mode 'rescan' = delta sync: index new files AND remove photos whose file is
 * gone from disk. Walks the full folder (no filter) so the removal pass works.
 */
export function startScan(
  services: LocalServices,
  folderPath: string,
  onProgress?: (p: ScanProgress) => void,
  mode: 'add' | 'rescan' = 'add',
): ScanHandle {
  let cancelled = false
  const scanId = `scan_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const done = (async () => {
    const analysis = await services.getAnalysis()
    return scanFolder(services.store, folderPath, analysis, {
      thumbDir: services.config.thumbDir,
      minFaceQuality: services.config.minFaceQuality,
      onProgress,
      shouldCancel: () => cancelled,
      // Pass OUR id so progress events + summary carry the same id the renderer
      // registered — otherwise the renderer sees a queued row (our id) plus a
      // fresh row (the scanner's own id) = double rows.
      scanId,
      // Resume-friendly: skip files already indexed under this folder so the
      // progress bar starts from the remaining work, not the whole folder.
      // (In-loop hash/path dedup in scanner.ts stays as a safety net.)
      rescan: mode === 'rescan',
      filterFile: mode === 'rescan'
        ? undefined
        : (filePath) => !services.store.hasPhotoPath(filePath),
    })
  })()
  return { scanId, cancel: () => { cancelled = true }, done }
}

export interface HitView {
  photoId: string
  path: string
  thumbUrl: string | null
  personId: string | null
  personName: string | null
  similarity: number
  faceId: string
  /** Bounding box of the matched face — for the grid rectangle highlight. */
  faceBox: { x1: number; y1: number; x2: number; y2: number; width: number | null; height: number | null } | null
  /** Distinct persons matched by any query face in this photo. */
  matchedPersons: string[]
}

export interface SearchView {
  facesDetected: number
  hits: HitView[]
}

function toHitView(h: SearchHit): HitView {
  return {
    photoId: h.photoId,
    path: h.path,
    thumbUrl: h.thumbPath ? `picly://thumb/${path.basename(h.thumbPath)}` : null,
    personId: h.personId,
    personName: h.personName,
    similarity: h.similarity,
    faceId: h.faceId,
    faceBox: h.faceBox,
    matchedPersons: h.matchedPersons ?? [],
  }
}

/** Detect faces in a query photo and search the library with ALL of them. */
export async function searchPhoto(services: LocalServices, photoPath: string, limit = 10): Promise<SearchView> {
  const analysis = await services.getAnalysis()
  const img = await decodeRgb(photoPath)
  const faces = await analysis.detectFromImage(img)
  // Only faces with an embedding can drive search (very_low-quality faces have
  // embedding null and are skipped — they're detections, not recognition).
  const embeddings = faces.map((f) => f.embedding).filter((e): e is Float32Array => e !== null)
  if (embeddings.length === 0) return { facesDetected: faces.length, hits: [] }
  const hits = services.store.searchFaces(embeddings, limit)
  return { facesDetected: faces.length, hits: hits.map(toHitView) }
}

/** Search using an already-stored photo's embeddings (no re-detect). */
export function searchStoredPhoto(services: LocalServices, photoId: string, limit = 10): SearchView {
  const faces = services.store.facesForPhoto(photoId)
  if (faces.length === 0) return { facesDetected: 0, hits: [] }
  const hits = services.store.searchFaces(faces, limit)
  return { facesDetected: faces.length, hits: hits.map(toHitView) }
}

export function listPhotos(services: LocalServices, folderPath?: string, limit = 500, offset = 0): unknown[] {
  return services.store.listPhotos(folderPath, limit, offset)
}

/** Photos scoped to a person (via faces), thumbnails mapped to picly:// URLs. */
export function listPersonPhotos(services: LocalServices, personId: string, limit = 500): unknown[] {
  return services.store.listPhotosForPerson(personId, limit).map((p) => ({
    ...p,
    thumbUrl: p.thumbPath ? `picly://thumb/${path.basename(p.thumbPath)}` : null,
  }))
}

/** Photos with no detected faces (landscape/docs/blank), thumbnails mapped. */
export function listPhotosNoFaces(services: LocalServices, limit = 500): unknown[] {
  return services.store.listPhotosNoFaces(limit).map((p) => ({
    ...p,
    thumbUrl: p.thumbPath ? `picly://thumb/${path.basename(p.thumbPath)}` : null,
  }))
}

/** Count of photos with no detected faces (sidebar badge). */
export function countPhotosNoFaces(services: LocalServices): number {
  return services.store.countPhotosNoFaces()
}

// -------------------------------------------------------------------- trash

/** Photos in the Trash (soft-deleted), thumbs mapped to picly:// URLs. */
export function listTrashedPhotos(services: LocalServices, limit = 500): unknown[] {
  return services.store.listTrashedPhotos(limit).map((p) => ({
    ...p,
    thumbUrl: p.thumbPath ? `picly://thumb/${path.basename(p.thumbPath)}` : null,
  }))
}

export function countTrashed(services: LocalServices): number {
  return services.store.countTrashed()
}

export function restorePhoto(services: LocalServices, photoId: string): boolean {
  return services.store.restorePhoto(photoId)
}

export function emptyTrash(services: LocalServices): number {
  return services.store.emptyTrash()
}

/** Face crop previews for a set of persons, mapped to picly://face URLs. */
export function listPersonPreviews(services: LocalServices, ids: string[]): unknown[] {
  return services.store.listPersonPreviews(ids).map((p) => ({
    ...p,
    faceUrl: p.faceId ? `picly://face/${p.faceId}.jpg` : null,
  }))
}

/** Faces (bbox + person) for one photo, for the detail-view overlay. */
export function photoFaces(services: LocalServices, photoId: string): unknown[] {
  return services.store.facesForPhotoView(photoId)
}
