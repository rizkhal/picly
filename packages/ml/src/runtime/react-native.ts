/**
 * React Native runtime adapter — used by the Expo mobile app.
 * Loads models from bundled assets (require / Asset) via onnxruntime-react-native.
 *
 * NOTE: this module is intentionally NOT exported from the package barrel —
 * it imports onnxruntime-react-native + expo modules (native), which only exist
 * on mobile. Mobile imports it via a direct subpath: 'picly-ml/runtime/react-native'.
 *
 * Image decode strategy:
 *   JPEG/PNG  -> decode bytes directly with pure-JS decoders (jpeg-js/pngjs)
 *   HEIC/other -> convert to JPEG via expo-image-manipulator, then decode
 *
 * EXIF orientation IS applied for JPEG (and the converted JPEG from HEIC):
 * React Native's <Image> renders with EXIF rotation natively, so boxes must
 * live in the SAME oriented coordinate space or every overlay shifts. This
 * intentionally differs from the desktop decoder (sharp ignores EXIF to match
 * cv2.imread) — on desktop the dataset is DSLR photos without EXIF rotation,
 * while mobile is phone photos where almost every portrait shot has one.
 *
 * Base64 decoding intentionally avoids Buffer (not a global in React Native);
 * `base64-js` is a tiny pure-JS decoder and ships with the RN bundle already
 * (Metro includes it as a transitive dep of many packages).
 */
import type { ImageDecoder, OrtBackend, OrtSessionLike } from '../runtime/types'

/** onnxruntime-react-native exposes the same onnxruntime-common API surface. */
export interface RnOrtBackendOptions {
  /** Number of intra-op threads (default: 2 — keep the UI thread responsive). */
  intraOpNumThreads?: number
}

class RnSession implements OrtSessionLike {
  private session: any
  constructor(session: any) {
    this.session = session
  }
  get inputNames(): readonly string[] {
    return this.session.inputNames
  }
  get outputNames(): readonly string[] {
    return this.session.outputNames
  }
  async run(feeds: Record<string, any>, fetches?: readonly string[]): Promise<Record<string, any>> {
    return this.session.run(feeds, fetches ? Array.from(fetches) : undefined)
  }
}

/** Lazy import so the native module is only touched on mobile. */
function loadRnOrt(): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('onnxruntime-react-native')
}

export function reactNativeOrtBackend(options: RnOrtBackendOptions = {}): OrtBackend {
  const ort = loadRnOrt()
  const intraOpNumThreads = options.intraOpNumThreads ?? 2
  return {
    async createSession(source, sessionOptions) {
      // onnxruntime-react-native: loadModel(path | buffer, options).
      // A string source is an asset uri / file uri; a buffer is raw ONNX bytes.
      let session: any
      if (typeof source === 'string') {
        session = await ort.InferenceSession.create(source, {
          executionProviders: ['cpu'],
          intraOpNumThreads,
          ...sessionOptions,
        })
      } else {
        const bytes = source instanceof Uint8Array ? source : new Uint8Array(source)
        session = await ort.InferenceSession.create(bytes.buffer, bytes.byteOffset, bytes.byteLength, {
          executionProviders: ['cpu'],
          intraOpNumThreads,
          ...sessionOptions,
        })
      }
      return new RnSession(session)
    },
  }
}

// ------------------------------------------------------------------ decode

const JPEG_MAGIC = [0xff, 0xd8, 0xff]
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]

function looksLikeJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === JPEG_MAGIC[0] && bytes[1] === JPEG_MAGIC[1] && bytes[2] === JPEG_MAGIC[2]
}

function looksLikePng(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === PNG_MAGIC[0] && bytes[1] === PNG_MAGIC[1] && bytes[2] === PNG_MAGIC[2] && bytes[3] === PNG_MAGIC[3]
}

/** Read a file uri as bytes (base64 via expo-file-system legacy API). */
async function readBytes(uri: string): Promise<Uint8Array> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const FileSystem = require('expo-file-system/legacy')
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 })
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const base64js = require('base64-js')
  return base64js.toByteArray(base64)
}

/** Convert any image uri to a JPEG file uri (normalizes HEIC/odd formats). */
async function convertToJpeg(uri: string): Promise<{ uri: string; width: number; height: number }> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ImageManipulator = require('expo-image-manipulator')
  const result = await ImageManipulator.manipulateAsync(uri, [], {
    compress: 0.92,
    format: ImageManipulator.SaveFormat.JPEG,
  })
  return { uri: result.uri, width: result.width, height: result.height }
}

/** Read the EXIF orientation (0x0112) from a JPEG's APP1 segment. 1=normal. */
function readJpegOrientation(bytes: Uint8Array): number {
  // APP1 must start right after the 2-byte SOI + 2-byte APPn marker.
  let offset = 2
  while (offset + 4 <= bytes.length) {
    const marker = (bytes[offset] << 8) | bytes[offset + 1]
    if (marker !== 0xffe1) {
      // APP0/APPn/other segment: skip by length.
      if (marker === 0xffd8 || marker === 0xffd9 || offset + 4 > bytes.length) break
      const len = (bytes[offset + 2] << 8) | bytes[offset + 3]
      offset += 2 + len
      continue
    }
    // APP1: starts with "Exif\0\0" then TIFF header.
    const segLen = (bytes[offset + 2] << 8) | bytes[offset + 3]
    const seg = bytes.subarray(offset + 4, offset + 2 + segLen)
    if (
      seg.length > 12 &&
      seg[0] === 0x45 && seg[1] === 0x78 && seg[2] === 0x69 && seg[3] === 0x66 &&
      seg[4] === 0 && seg[5] === 0
    ) {
      const tiff = seg.subarray(6)
      const isBE = tiff[0] === 0x4d && tiff[1] === 0x4d // "MM" big-endian
      const get16 = (o: number) =>
        isBE ? (tiff[o] << 8) | tiff[o + 1] : tiff[o] | (tiff[o + 1] << 8)
      const get32 = (o: number) =>
        isBE
          ? ((tiff[o] << 24) | (tiff[o + 1] << 16) | (tiff[o + 2] << 8) | tiff[o + 3]) >>> 0
          : (tiff[o] | (tiff[o + 1] << 8) | (tiff[o + 2] << 16) | (tiff[o + 3] << 24)) >>> 0
      if (get16(2) !== 42) break // invalid TIFF magic
      const ifd0 = get32(4)
      const n = get16(ifd0)
      for (let i = 0; i < n; i++) {
        const e = ifd0 + 2 + i * 12
        if (get16(e) === 0x0112) {
          const type = get16(e + 2)
          const value = type === 3 ? get16(e + 8) : get32(e + 8)
          if (value >= 1 && value <= 8) return value
          return 1
        }
      }
    }
    break
  }
  return 1
}

/** Rotate raw RGB pixels per EXIF orientation, returning oriented w/h. */
function applyOrientation(data: Uint8Array, w: number, h: number, orientation: number): { width: number; height: number; data: Uint8Array } {
  if (orientation <= 1) return { width: w, height: h, data }
  const src = data
  const out = new Uint8Array(src.length) // same size: 90° swap swaps w/h, 180° keeps it
  const o = orientation
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 3
      const r = src[si]
      const g = src[si + 1]
      const b = src[si + 2]
      let dx = x
      let dy = y
      if (o === 3) {
        dx = w - 1 - x
        dy = h - 1 - y
      } else if (o === 6) {
        // 90° CW: (x,y) -> (h-1-y, x)
        dx = h - 1 - y
        dy = x
      } else if (o === 8) {
        // 270° CW: (x,y) -> (y, w-1-x)
        dx = y
        dy = w - 1 - x
      } else if (o === 2) {
        dx = w - 1 - x
      } else if (o === 4) {
        dy = h - 1 - y
      } else if (o === 5) {
        // transpose (mirror along top-left/bottom-right diagonal)
        dx = y
        dy = x
      } else if (o === 7) {
        // transverse (mirror along top-right/bottom-left diagonal)
        dx = h - 1 - y
        dy = w - 1 - x
      } else {
        return { width: w, height: h, data }
      }
      const di = (dy * (o === 6 || o === 8 || o === 5 || o === 7 ? h : w) + dx) * 3
      out[di] = r
      out[di + 1] = g
      out[di + 2] = b
    }
  }
  const swap = o === 6 || o === 8 || o === 5 || o === 7
  return { width: swap ? h : w, height: swap ? w : h, data: out }
}

/**
 * Mobile image decoder — decodes a content:// or file:// uri to raw RGB.
 * JPEG EXIF orientation is APPLIED so boxes match what <Image> renders;
 * HEIC and other non-JPEG/PNG formats go through expo-image-manipulator which
 * decodes natively (already oriented) then converts to JPEG.
 */
export function reactNativeImageDecoder(): ImageDecoder {
  return {
    async decode(source: string) {
      const raw = await readBytes(source)
      let bytes = raw
      let knownW = 0
      let knownH = 0
      if (!looksLikeJpeg(bytes) && !looksLikePng(bytes)) {
        // HEIC / webp / etc — convert via native decoder first.
        const converted = await convertToJpeg(source)
        bytes = await readBytes(converted.uri)
        knownW = converted.width
        knownH = converted.height
      }
      if (looksLikePng(bytes)) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const pngjs = require('pngjs')
        const png = pngjs.PNG.sync.read(bytes)
        const data = new Uint8Array(png.width * png.height * 3)
        for (let i = 0, p = 0; i < png.data.length; i += 4, p += 3) {
          data[p] = png.data[i]
          data[p + 1] = png.data[i + 1]
          data[p + 2] = png.data[i + 2]
        }
        return { width: png.width, height: png.height, data }
      }
      if (looksLikeJpeg(bytes)) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const jpegjs = require('jpeg-js')
        const img = jpegjs.decode(bytes, {
          useTArray: true,
          formatAsRGBA: false,
        })
        return applyOrientation(img.data, img.width, img.height, readJpegOrientation(bytes))
      }
      // Fallback: use the dimension info from the converter (rare).
      if (knownW > 0 && knownH > 0) {
        // Try JPEG decode anyway — some formats decode fine despite magic mismatch.
        const jpegjs = require('jpeg-js')
        try {
          const img = jpegjs.decode(bytes, {
            useTArray: true,
            formatAsRGBA: false,
          })
          return applyOrientation(img.data, img.width, img.height, readJpegOrientation(bytes))
        } catch {
          // no-op fall through
        }
      }
      throw new Error(`Unsupported image format for ${source}`)
    },
  }
}
