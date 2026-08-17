/**
 * Desktop eDifFIQA quality scorer — provided by the shared `picly-ml` package.
 * Wraps the runtime-agnostic scorer with the desktop (onnxruntime-node)
 * backend so existing callers keep the same constructor signature.
 */
import * as ort from 'onnxruntime-node'
import { QualityScorer as SharedQualityScorer } from 'picly-ml'
import type { RgbImage } from 'picly-ml'

/** Desktop quality scorer. `QualityScorer.create(modelPath)` loads via
 * onnxruntime-node from the filesystem path. */
export class QualityScorer {
  private inner: SharedQualityScorer
  private constructor(inner: SharedQualityScorer) {
    this.inner = inner
  }

  static async create(modelPath: string, size = 112): Promise<QualityScorer> {
    return new QualityScorer(await SharedQualityScorer.create(modelPath, nodeBackend(), modelPath, size))
  }

  /** Score an ALREADY-ALIGNED 112x112 face crop (RGB). Higher = better. */
  async scoreAligned(aimg: RgbImage): Promise<number> {
    return this.inner.scoreAligned(aimg)
  }
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
