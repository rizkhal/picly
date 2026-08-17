import { Tensor } from 'onnxruntime-common'
import { toNchwBlob } from './image'
import type { RgbImage } from './types'
import type { ModelSource, OrtBackend, OrtSessionLike } from './runtime/types'

/**
 * eDifFIQA-T face-image quality scorer (Babnik et al., IEEE T-BIOM 2024 —
 * UniFace port of "eDifFIQA: Towards Efficient Face Image Quality Assessment
 * based on Denoising Diffusion Probabilistic Models").
 *
 * Predicts a single scalar per aligned 112x112 face crop (higher = better
 * quality: sharpness, frontalness, illumination, low occlusion). It is trained
 * on the SAME input as ArcFace — aligned RGB 112x112, (pixel - 127.5) / 127.5,
 * NCHW float32 — so we can reuse `toNchwBlob` unchanged (verified against the
 * Python reference: blobFromImage(aligned, 1/127.5, (112,112), 127.5, swapRB)).
 *
 * The score is NOT a calibrated probability (per the official README) — the
 * decision threshold must be calibrated on our own data. PoC on
 * psdkp-sample-tile: phantom-cluster (non-face) crops score <= 0.30 (median
 * ~0.16) while clearly-good faces (>=64px, det >= 0.7) score up to 0.756 with
 * median ~0.37; the sweet spot is 0.20-0.25.
 */
export class QualityScorer {
  private session!: OrtSessionLike
  private inputName = ''
  private outputName = ''
  private size: number

  private constructor(size: number) {
    this.size = size
  }

  static async create(modelPath: string, backend: OrtBackend, source: ModelSource, size = 112): Promise<QualityScorer> {
    const q = new QualityScorer(size)
    q.session = await backend.createSession(source, { executionProviders: ['cpu'] })
    q.inputName = q.session.inputNames[0]
    q.outputName = q.session.outputNames[0]
    return q
  }

  /** Score an ALREADY-ALIGNED 112x112 face crop (RGB). Higher = better. */
  async scoreAligned(aimg: RgbImage): Promise<number> {
    const blob = toNchwBlob(aimg, 127.5, 1 / 127.5)
    const feeds = { [this.inputName]: new Tensor('float32', blob, [1, 3, this.size, this.size]) }
    const out = await this.session.run(feeds, [this.outputName])
    const data = out[this.outputName].data as Float32Array
    return data.length > 0 ? data[0] : 0
  }
}
