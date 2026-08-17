/**
 * Desktop FaceAnalysis — the full detection+quality+embedding pipeline from
 * the shared `picly-ml` package, wired to the desktop runtime (onnxruntime-node
 * for sessions, sharp for decode).
 *
 * `FaceAnalysis.create(options?)` keeps the original desktop signature (no
 * required args — model paths resolve from the monorepo root /models or
 * PICLY_MODELS_DIR), so local.ts / scanner.ts / scripts/*.cjs are untouched.
 */
import sharp from 'sharp'
import * as ort from 'onnxruntime-node'
import { FaceAnalysis as SharedFaceAnalysis } from 'picly-ml'
import { defaultDesktopModels } from 'picly-ml/dist/desktop-models'
import type { DetectedFace, FaceAnalysisOptions as SharedFaceAnalysisOptions, RgbImage } from 'picly-ml'

export { ARCFACE_DST, RE_DETECT_FACE_PX, NMS_IOU } from 'picly-ml'
export type { DetectTimings, DetectBreakdown } from 'picly-ml'

/** Desktop options: same knobs as the shared pipeline, plus an optional
 * modelsDir override (default root /models or PICLY_MODELS_DIR). */
export interface FaceAnalysisOptions extends Omit<SharedFaceAnalysisOptions, 'backend' | 'decoder' | 'models'> {
  modelsDir?: string
}

let backendInstance: ReturnType<typeof makeNodeBackend> | null = null
function nodeBackend() {
  if (!backendInstance) backendInstance = makeNodeBackend()
  return backendInstance
}

function makeNodeBackend() {
  return {
    async createSession(source: string | ArrayBuffer | Uint8Array, options?: ort.InferenceSession.SessionOptions) {
      const session = await ort.InferenceSession.create(source as string, { executionProviders: ['cpu'], ...options })
      return {
        get inputNames() {
          return session.inputNames
        },
        get outputNames() {
          return session.outputNames
        },
        run: (feeds: Record<string, any>, fetches?: readonly string[]) => (fetches ? session.run(feeds, Array.from(fetches)) : session.run(feeds)),
      }
    },
  }
}

const sharpDecoder = {
  async decode(source: string): Promise<{ width: number; height: number; data: Uint8Array }> {
    // sharp ignores EXIF orientation by default, matching cv2.imread (the
    // Python reference) — same behavior as the original desktop decodeRgb.
    const { data, info } = await sharp(source, { failOn: 'none' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    return { width: info.width, height: info.height, data }
  },
}

/**
 * Desktop face pipeline. Same class name + static create as the original so
 * all existing imports (`./ml/faceAnalysis`) and scripts keep working.
 */
export class FaceAnalysis {
  private inner: SharedFaceAnalysis

  private constructor(inner: SharedFaceAnalysis) {
    this.inner = inner
  }

  static async create(options: FaceAnalysisOptions = {}): Promise<FaceAnalysis> {
    const { modelsDir, ...rest } = options
    const models = defaultDesktopModels(modelsDir)
    const inner = await SharedFaceAnalysis.create({
      ...rest,
      backend: nodeBackend(),
      decoder: sharpDecoder,
      models,
    })
    return new FaceAnalysis(inner)
  }

  /** Detect + embed faces in an image file (path). */
  async detect(imagePath: string): Promise<DetectedFace[]> {
    return this.inner.detect(imagePath)
  }

  /** Detect + embed faces from an already-decoded RgbImage. */
  async detectFromImage(img: RgbImage): Promise<DetectedFace[]> {
    return this.inner.detectFromImage(img)
  }

  /** Public helper for tools/scripts: warp an aligned 112x112 RGB crop. */
  async warpAlignedPublic(img: RgbImage, kps: number[][]): Promise<RgbImage> {
    return this.inner.warpAlignedPublic(img, kps)
  }

  /** Timing of the last detectFromImage call (per-stage breakdown). */
  get lastTimings() {
    return this.inner.lastTimings
  }

  /** Detection counts of the last detectFromImage call. */
  get lastBreakdown() {
    return this.inner.lastBreakdown
  }
}
