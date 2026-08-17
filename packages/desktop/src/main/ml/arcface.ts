/**
 * Desktop ArcFace embedder — provided by the shared `picly-ml` package.
 * Wraps the runtime-agnostic embedder with the desktop (onnxruntime-node)
 * backend so existing callers keep the same constructor signature.
 */
import * as ort from 'onnxruntime-node'
import { ArcFaceEmbedder as SharedArcFaceEmbedder } from 'picly-ml'
import type { ModelConfig, RgbImage } from 'picly-ml'

/** Desktop ArcFace embedder. `ArcFaceEmbedder.create(config)` loads via
 * onnxruntime-node from the filesystem path in `config.arcModel`. */
export class ArcFaceEmbedder {
  private inner: SharedArcFaceEmbedder
  private constructor(inner: SharedArcFaceEmbedder) {
    this.inner = inner
  }

  static async create(config: ModelConfig): Promise<ArcFaceEmbedder> {
    return new ArcFaceEmbedder(await SharedArcFaceEmbedder.create(config, nodeBackend(), config.arcModel))
  }

  async getFeat(aimg: RgbImage): Promise<Float32Array> {
    return this.inner.getFeat(aimg)
  }

  l2Normalize(feat: Float32Array): Float32Array {
    return this.inner.l2Normalize(feat)
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
