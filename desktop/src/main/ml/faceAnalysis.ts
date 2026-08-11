import { buffaloL, type ModelConfig } from './config'
import { decodeRgb, letterbox, warpAffine } from './image'
import { umeyama } from './matrix'
import { ArcFaceEmbedder } from './arcface'
import { ScrfdDetector } from './scrfd'
import type { DetectedFace, RgbImage } from './types'

/** ArcFace alignment template (arcface_dst from insightface/utils/face_align.py). */
export const ARCFACE_DST: number[][] = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
]

export interface FaceAnalysisOptions {
  modelsDir?: string
  detSize?: number
  detThresh?: number
}

/**
 * Face detection + embedding pipeline, mirroring insightface's FaceAnalysis
 * (buffalo_l, det_size 640) but running fully in Node via ONNX Runtime:
 *   SCRFD detect -> estimate_norm(raw kps) -> warp 112x112 -> ArcFace -> L2 norm.
 */
export class FaceAnalysis {
  private detector: ScrfdDetector
  private embedder: ArcFaceEmbedder
  private config: ModelConfig
  private detSize: number
  private detThresh: number

  private constructor(
    detector: ScrfdDetector,
    embedder: ArcFaceEmbedder,
    config: ModelConfig,
    detSize: number,
    detThresh: number,
  ) {
    this.detector = detector
    this.embedder = embedder
    this.config = config
    this.detSize = detSize
    this.detThresh = detThresh
  }

  static async create(options: FaceAnalysisOptions = {}): Promise<FaceAnalysis> {
    const config = buffaloL(options.modelsDir ?? process.env.PICLY_MODELS_DIR)
    const detector = await ScrfdDetector.create(config)
    const embedder = await ArcFaceEmbedder.create(config)
    return new FaceAnalysis(
      detector,
      embedder,
      config,
      options.detSize ?? 640,
      options.detThresh ?? 0.5,
    )
  }

  async detect(imagePath: string): Promise<DetectedFace[]> {
    const img = await decodeRgb(imagePath)
    return this.detectFromImage(img)
  }

  async detectFromImage(img: RgbImage): Promise<DetectedFace[]> {
    const { resized, detScale } = letterbox(img, this.detSize)
    const { bboxes, scores, kpss } = await this.detector.detect(
      resized,
      this.detSize,
      this.detThresh,
      detScale,
    )

    const faces: DetectedFace[] = []
    for (let i = 0; i < bboxes.length; i++) {
      const M = umeyama(kpss[i], ARCFACE_DST)
      const aimg = warpAffine(img, M, this.config.arcInputSize)
      const feat = await this.embedder.getFeat(aimg)
      faces.push({
        bbox: bboxes[i] as [number, number, number, number],
        detScore: scores[i],
        kps: kpss[i],
        embedding: this.embedder.l2Normalize(feat),
      })
    }
    return faces
  }
}
