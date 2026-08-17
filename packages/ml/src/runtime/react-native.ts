/**
 * React Native runtime adapter — used by the Expo mobile app.
 * Loads models from bundled assets (require / Asset) via onnxruntime-react-native.
 *
 * NOTE: this module is intentionally NOT exported from the package barrel —
 * it imports onnxruntime-react-native + expo modules (native), which only exist
 * on mobile. Mobile imports it via a direct subpath: 'picly-ml/runtime/react-native'.
 *
 * Image decode strategy (keeps EXIF orientation IGNORED to match cv2.imread,
 * the Python reference — same behavior as the desktop sharp decoder):
 *   JPEG/PNG  -> decode bytes directly with pure-JS decoders (jpeg-js/pngjs)
 *   HEIC/other -> convert to JPEG via expo-image-manipulator, then decode
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

/**
 * Mobile image decoder — decodes a content:// or file:// uri to raw RGB.
 * EXIF orientation is intentionally NOT applied (matches desktop cv2.imread
 * reference); HEIC and other non-JPEG/PNG formats go through
 * expo-image-manipulator which decodes them natively.
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
        return { width: img.width, height: img.height, data: img.data }
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
          return { width: img.width, height: img.height, data: img.data }
        } catch {
          // no-op fall through
        }
      }
      throw new Error(`Unsupported image format for ${source}`)
    },
  }
}
