import { closeSync, mkdirSync, openSync, readSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import xxhash from 'xxhash-wasm'
import type { PhotoStore } from './db/store'
import type { FaceAnalysis } from './ml/faceAnalysis'
import { makeThumbnail, THUMB_SIZE } from './thumb'

export const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.webp'])
const HASH_CHUNK = 64 * 1024

export interface ScanProgress {
  scanId: string
  folder: string
  total: number
  processed: number
  scanned: number
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
      } else if (e.isFile() && IMAGE_EXTS.has(path.extname(e.name).toLowerCase())) {
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
  const scanId = `scan_${started}_${Math.random().toString(36).slice(2, 8)}`
  const files = options.files ?? collectImages(folderPath)
  const total = files.length

  const progress: ScanProgress = {
    scanId,
    folder: folderPath,
    total,
    processed: 0,
    scanned: 0,
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
  for (const filePath of files) {
    if (options.shouldCancel?.()) {
      cancelled = true
      break
    }
    progress.processed += 1
    progress.currentFile = filePath
    emit()
    try {
      // Content-hash dedup (same bytes, different paths)
      const hash = await contentHash(filePath)
      if (store.hasPhotoHash(hash)) continue
      if (store.hasPhotoPath(filePath)) continue

      const faces = await analysis.detect(filePath)
      if (faces.length === 0) continue

      const photoId = randomUUID()
      const thumbPath = path.join(options.thumbDir, `${photoId}.jpg`)
      await makeThumbnail(filePath, thumbPath, THUMB_SIZE)

      let width: number | null = null
      let height: number | null = null
      try {
        const meta = await sharpMeta(filePath)
        width = meta.width ?? null
        height = meta.height ?? null
      } catch {
        // non-fatal
      }

      const results = store.addPhotoWithFaces(
        { id: photoId, path: filePath, width, height, thumbPath, contentHash: hash },
        faces.map((face) => ({
          photoId,
          x1: Math.round(face.bbox[0]),
          y1: Math.round(face.bbox[1]),
          x2: Math.round(face.bbox[2]),
          y2: Math.round(face.bbox[3]),
          embedding: face.embedding,
        })),
      )
      if (results === null) continue // path appeared mid-scan; treat as duplicate
      personCount += results.filter((r) => r.isNewPerson).length
      progress.scanned += 1
      progress.totalFaces += faces.length
      progress.persons = personCount
      emit()
    } catch (e) {
      console.error(`scan error [${filePath}]:`, e)
      progress.errors += 1
      emit()
    }
  }

  store.markFolderScanned(folderPath)
  progress.status = cancelled ? 'cancelled' : 'done'
  progress.currentFile = null
  progress.persons = personCount
  emit()

  return {
    scanId,
    total,
    scanned: progress.scanned,
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
