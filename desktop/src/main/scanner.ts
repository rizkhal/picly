import { closeSync, mkdirSync, openSync, readSync, readdirSync, unlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import xxhash from 'xxhash-wasm'
import type { PhotoStore } from './db/store'
import type { FaceAnalysis } from './ml/faceAnalysis'
import { makeThumbnail, makeFaceCrop, THUMB_SIZE, FACE_CROP_SIZE } from './thumb'

export const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.webp'])
const HASH_CHUNK = 64 * 1024

/** True for macOS AppleDouble sidecar files (dot-underscore prefix). */
function isAppleDouble(name: string): boolean {
  return name.startsWith('._')
}

export interface ScanProgress {
  scanId: string
  folder: string
  total: number
  processed: number
  scanned: number
  /** Photos removed during a rescan (files no longer on disk). */
  removed?: number
  totalFaces: number
  persons: number
  errors: number
  status: 'queued' | 'running' | 'done' | 'cancelled' | 'error'
  currentFile: string | null
}

export interface ScanSummary {
  scanId: string
  total: number
  scanned: number
  removed: number
  totalFaces: number
  persons: number
  errors: number
  cancelled: boolean
  elapsedMs: number
}

export interface ScanOptions {
  thumbDir: string
  onProgress?: (p: ScanProgress) => void
  shouldCancel?: () => boolean
  /** Explicit file list; defaults to collectImages(folderPath). */
  files?: string[]
  /** Skip files before scanning starts (e.g. already-indexed paths) so the
   *  progress bar reflects only the remaining work. Path-based, cheap. */
  filterFile?: (filePath: string) => boolean
  /** Rescan mode: after indexing, remove photos whose file no longer exists on
   *  disk (delta sync — no re-embed of unchanged photos). filterFile is ignored
   *  in this mode so the full folder is walked for the removal pass. */
  rescan?: boolean
  /** Stable id for this scan. When absent, scanFolder generates its own. The
   *  id is what progress events + the summary carry, so the caller (local.ts)
   *  and the scanner MUST agree on it — otherwise the renderer sees two rows
   *  (one from startScan's id, one from the events). */
  scanId?: string
  /**
   * Drop faces whose eDifFIQA (quality_score) is below this before storing.
   * "Better absent than blurry": blurry detections are neither shown as
   * rectangles nor stored, so photos end up with only usable faces and the
   * face filter only shows people worth recognizing. Set to 0 to keep every
   * detection. Default 0 (keep everything — existing behavior).
   */
  minFaceQuality?: number
}

const hasherPromise = xxhash()

/** xxHash64 of file contents (same digest scheme as the Python backend). */
async function contentHash(filePath: string): Promise<string> {
  const hasher = (await hasherPromise).create64()
  const buf = Buffer.alloc(HASH_CHUNK)
  const handle = openSync(filePath, 'r')
  try {
    let pos = 0
    for (;;) {
      const n = readSync(handle, buf, 0, HASH_CHUNK, pos)
      if (n <= 0) break
      hasher.update(new Uint8Array(buf.buffer, 0, n))
      pos += n
      if (n < HASH_CHUNK) break
    }
  } finally {
    closeSync(handle)
  }
  return hasher.digest().toString(16).padStart(16, '0')
}

/** Recursively list image files under root, sorted for deterministic scans. */
export function collectImages(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(full)
      } else if (
        e.isFile() &&
        !isAppleDouble(e.name) &&
        IMAGE_EXTS.has(path.extname(e.name).toLowerCase())
      ) {
        out.push(full)
      }
    }
  }
  walk(root)
  return out
}

export async function scanFolder(
  store: PhotoStore,
  folderPath: string,
  analysis: FaceAnalysis,
  options: ScanOptions,
): Promise<ScanSummary> {
  const started = Date.now()
  const scanId = options.scanId ?? `scan_${started}_${Math.random().toString(36).slice(2, 8)}`
  const allFiles = options.files ?? collectImages(folderPath)
  // Rescan walks the FULL folder (removal pass needs every path). Add-mode
  // respects filterFile so a resume only continues the remaining work.
  const files = options.rescan ? allFiles : (options.filterFile ? allFiles.filter(options.filterFile) : allFiles)
  const total = files.length

  const progress: ScanProgress = {
    scanId,
    folder: folderPath,
    total,
    processed: 0,
    scanned: 0,
    removed: 0,
    totalFaces: 0,
    persons: store.listPersons().length,
    errors: 0,
    status: 'running',
    currentFile: null,
  }
  const emit = () => options.onProgress?.({ ...progress })

  store.addFolder(folderPath, path.basename(folderPath))
  mkdirSync(options.thumbDir, { recursive: true })

  let personCount = store.listPersons().length
  let cancelled = false
  const checkCancel = (): boolean => {
    if (options.shouldCancel?.()) {
      cancelled = true
      return true
    }
    return false
  }
  for (const filePath of files) {
    if (checkCancel()) break
    progress.processed += 1
    progress.currentFile = filePath
    emit()
    if (isAppleDouble(path.basename(filePath))) continue // macOS sidecar, not an image
    try {
      // Content-hash dedup (same bytes, different paths)
      const hash = await contentHash(filePath)
      if (store.hasPhotoHash(hash)) continue
      if (store.hasPhotoPath(filePath)) continue
      if (checkCancel()) break // stop before the expensive detect

      // Read metadata once (cheap, used for thumb/crop bounds).
      let width: number | null = null
      let height: number | null = null
      try {
        const meta = await sharpMeta(filePath)
        width = meta.width ?? null
        height = meta.height ?? null
      } catch {
        // non-fatal
      }

      const faces = await analysis.detect(filePath)
      const minQ = options.minFaceQuality ?? 0
      // "Better absent than blurry": drop detections below the eDifFIQA floor
      // so blurry rectangles never reach the UI/DB and the remaining faces are
      // the ones we want to optimize for.
      const kept = minQ > 0 ? faces.filter((f) => f.qualityScore >= minQ) : faces
      if (kept.length === 0) continue
      if (checkCancel()) break // stop before writing thumb/crops

      const photoId = randomUUID()
      const thumbPath = path.join(options.thumbDir, `${photoId}.jpg`)
      await makeThumbnail(filePath, thumbPath, THUMB_SIZE)
      // No cancel check here: thumb + crops + DB row should commit together so
      // we never leave orphan crops behind. Cancel before detect is the responsive
      // stop point; once a file is past detect it finishes writing.

      // Assign stable face ids first so each crop file can share the face id name.
      const faceIds = kept.map(() => randomUUID())
      await Promise.all(
        kept.map((face, i) =>
          makeFaceCrop(filePath, path.join(options.thumbDir, `${faceIds[i]}.jpg`), face.bbox, FACE_CROP_SIZE, width, height),
        ),
      )

      const results = store.addPhotoWithFaces(
        { id: photoId, path: filePath, width, height, thumbPath, contentHash: hash },
        kept.map((face, i) => ({
          id: faceIds[i],
          photoId,
          x1: Math.round(face.bbox[0]),
          y1: Math.round(face.bbox[1]),
          x2: Math.round(face.bbox[2]),
          y2: Math.round(face.bbox[3]),
          embedding: face.embedding,
          faceQuality: face.quality,
          qualityScore: face.qualityScore,
          lowQuality: face.lowQuality,
        })),
      )
      if (results === null) continue // path appeared mid-scan; treat as duplicate
      personCount += results.filter((r) => r.isNewPerson).length
      progress.scanned += 1
      progress.totalFaces += kept.length
      progress.persons = personCount
      emit()
    } catch (e) {
      console.error(`scan error [${filePath}]:`, e)
      progress.errors += 1
      emit()
    }
  }

  store.markFolderScanned(folderPath)

  // Offline clustering: faces were stored unassigned during the scan; run HAC
  // over ALL faces (new + existing) so persons stay globally consistent and
  // order-independent. Skip when cancelled (no partial re-cluster).
  if (!cancelled) {
    personCount = store.clusterAllFaces()
    progress.persons = personCount
    emit()
  }

  // Rescan: remove photos whose file is gone from disk (delta sync). Faces
  // cascade-delete via FK; thumbnail/crop files are cleaned up alongside.
  if (options.rescan && !cancelled) {
    const disk = new Set(allFiles)
    for (const row of store.listFolderPhotos(folderPath)) {
      if (checkCancel()) break
      if (!disk.has(row.path)) {
        store.deletePhoto(row.photoId)
        if (row.thumbPath) try { unlinkSync(row.thumbPath) } catch { /* already gone */ }
        progress.removed! += 1
        progress.processed += 1
        emit()
      }
    }
  }

  progress.status = cancelled ? 'cancelled' : 'done'
  progress.currentFile = null
  progress.persons = personCount
  emit()

  return {
    scanId,
    total,
    scanned: progress.scanned,
    removed: progress.removed ?? 0,
    totalFaces: progress.totalFaces,
    persons: progress.persons,
    errors: progress.errors,
    cancelled,
    elapsedMs: Date.now() - started,
  }
}

async function sharpMeta(filePath: string): Promise<{ width?: number; height?: number }> {
  const { default: sharp } = await import('sharp')
  return sharp(filePath, { failOn: 'none' }).metadata()
}
