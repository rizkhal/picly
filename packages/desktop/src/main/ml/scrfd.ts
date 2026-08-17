/**
 * Desktop SCRFD detector — provided by the shared `picly-ml` package.
 * Wraps the runtime-agnostic detector with the desktop (onnxruntime-node)
 * backend so existing callers (FaceAnalysis.create / scripts) keep working
 * with the same constructor signature as before.
 */
import * as ort from 'onnxruntime-node'
import { ScrfdDetector as SharedScrfdDetector } from 'picly-ml'
import type { ScrfDetResult, ModelConfig, RgbImage } from 'picly-ml'

export { type ScrfDetResult } from 'picly-ml'

/**
 * Desktop SCRFD detector. Drop-in replacement for the original class:
 * `ScrfdDetector.create(config)` loads via onnxruntime-node from the
 * filesystem path in `config.detModel`.
 */
export class ScrfdDetector {
  private inner: SharedScrfdDetector
  private constructor(inner: SharedScrfdDetector) {
    this.inner = inner
  }

  static async create(config: ModelConfig): Promise<ScrfdDetector> {
    return new ScrfdDetector(await SharedScrfdDetector.create(config, nodeBackend(), config.detModel))
  }

  /** Same signature as the shared detector (used by FaceAnalysis). */
  async detect(img: RgbImage, detSize: number, detThresh: number, detScale: number): Promise<ScrfDetResult> {
    return this.inner.detect(img, detSize, detThresh, detScale)
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
