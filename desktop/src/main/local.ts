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
  const store = PhotoStore.open(config.dbPath)
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

/** Start a folder scan; progress is streamed via onProgress. */
export function startScan(
  services: LocalServices,
  folderPath: string,
  onProgress?: (p: ScanProgress) => void,
): ScanHandle {
  let cancelled = false
  const scanId = `scan_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const done = (async () => {
    const analysis = await services.getAnalysis()
    return scanFolder(services.store, folderPath, analysis, {
      thumbDir: services.config.thumbDir,
      onProgress,
      shouldCancel: () => cancelled,
      // Resume-friendly: skip files already indexed under this folder so the
      // progress bar starts from the remaining work, not the whole folder.
      // (In-loop hash/path dedup in scanner.ts stays as a safety net.)
      filterFile: (filePath) => !services.store.hasPhotoPath(filePath),
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
    matchedPersons: h.matchedPersons ?? [],
  }
}

/** Detect faces in a query photo and search the library with ALL of them. */
export async function searchPhoto(services: LocalServices, photoPath: string, limit = 10): Promise<SearchView> {
  const analysis = await services.getAnalysis()
  const img = await decodeRgb(photoPath)
  const faces = await analysis.detectFromImage(img)
  if (faces.length === 0) return { facesDetected: 0, hits: [] }
  const hits = services.store.searchFaces(
    faces.map((f) => f.embedding),
    limit,
  )
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

/** Face box for a single photo scoped to a person filter (grid highlight). */
export function faceBoxForPhoto(services: LocalServices, personId: string, photoId: string): unknown {
  return services.store.faceBoxForPhoto(personId, photoId)
}
