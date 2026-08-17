import { Tensor } from 'onnxruntime-common'
import type { ModelConfig } from './config'
import { toNchwBlob } from './image'
import type { RgbImage } from './types'
import type { ModelSource, OrtBackend, OrtSessionLike } from './runtime/types'

/**
 * ArcFace recognition (w600k_r50) — exact port of insightface ArcFaceONNX.get_feat:
 * input is an RGB 112x112 crop, normalized (pixel - 127.5) / 127.5, NCHW float32.
 * Callers are responsible for L2-normalizing the output (normed_embedding).
 */
export class ArcFaceEmbedder {
  private session!: OrtSessionLike
  private config: ModelConfig
  private inputName = ''
  private outputName = ''

  private constructor(config: ModelConfig) {
    this.config = config
  }

  static async create(config: ModelConfig, backend: OrtBackend, source: ModelSource): Promise<ArcFaceEmbedder> {
    const a = new ArcFaceEmbedder(config)
    a.session = await backend.createSession(source, { executionProviders: ['cpu'] })
    a.inputName = a.session.inputNames[0]
    a.outputName = a.session.outputNames[0]
    return a
  }

  async getFeat(aimg: RgbImage): Promise<Float32Array> {
    const { config } = this
    const size = config.arcInputSize
    const blob = toNchwBlob(aimg, config.arcInputMean, 1 / config.arcInputStd)
    const feeds = { [this.inputName]: new Tensor('float32', blob, [1, 3, size, size]) }
    const out = await this.session.run(feeds, [this.outputName])
    const data = out[this.outputName].data as Float32Array
    return new Float32Array(data)
  }

  l2Normalize(feat: Float32Array): Float32Array {
    let sum = 0
    for (let i = 0; i < feat.length; i++) sum += feat[i] * feat[i]
    const norm = Math.sqrt(sum)
    const out = new Float32Array(feat.length)
    if (norm > 0) {
      for (let i = 0; i < feat.length; i++) out[i] = feat[i] / norm
    }
    return out
  }
}
