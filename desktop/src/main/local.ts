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
  }
}

/** Detect faces in a query photo and search the library with the first face. */
export async function searchPhoto(services: LocalServices, photoPath: string, limit = 10): Promise<SearchView> {
  const analysis = await services.getAnalysis()
  const img = await decodeRgb(photoPath)
  const faces = await analysis.detectFromImage(img)
  if (faces.length === 0) return { facesDetected: 0, hits: [] }
  const hits = services.store.searchFaces(faces[0].embedding, limit)
  return { facesDetected: faces.length, hits: hits.map(toHitView) }
}

/** Search using an already-stored photo's embedding (no re-detect). */
export function searchStoredPhoto(services: LocalServices, photoId: string, limit = 10): SearchView {
  const faces = services.store.facesForPhoto(photoId)
  if (faces.length === 0) return { facesDetected: 0, hits: [] }
  const hits = services.store.searchFaces(faces[0], limit)
  return { facesDetected: faces.length, hits: hits.map(toHitView) }
}

export function listPhotos(services: LocalServices, folderPath?: string, limit = 500, offset = 0): unknown[] {
  return services.store.listPhotos(folderPath, limit, offset)
}
