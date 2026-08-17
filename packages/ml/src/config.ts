import type { ModelSource } from './runtime/types'

/**
 * Model + preprocessing configuration for the face pipeline.
 * Config-driven on purpose: swapping to a lighter model pack (e.g. buffalo_s)
 * later only means changing these values — the pipeline code stays the same.
 *
 * The `detModel` / `arcModel` / `qualityModel` fields carry a platform-specific
 * source (filesystem path on desktop, asset uri / buffer on mobile) — the
 * runtime adapter knows how to load each.
 */
export interface ModelConfig {
  /** Source for the SCRFD detection ONNX model (filesystem path on desktop, bundled asset/buffer on mobile). */
  detModel: ModelSource
  /** Source for the ArcFace recognition ONNX model. */
  arcModel: ModelSource
  /** Source for the eDifFIQA face-quality ONNX model. */
  qualityModel: ModelSource
  /** Square detection input size in px. */
  detInputSize: number
  /** Feature pyramid strides of the detector (8/16/32 for SCRFD). */
  detStrides: number[]
  /** Anchors per grid cell (SCRFD uses 2). */
  detNumAnchors: number
  /** Input normalization for the detector (cv2 blobFromImage). */
  detInputMean: number
  detInputStd: number
  /** ArcFace input size (112 for buffalo_l). */
  arcInputSize: number
  /** Input normalization for ArcFace (mean/std from the model graph). */
  arcInputMean: number
  arcInputStd: number
  /** Detection confidence threshold. */
  detThresh: number
  /** NMS IoU threshold. */
  nmsThresh: number
}

export function buffaloL(models: { detModel: ModelSource; arcModel: ModelSource; qualityModel: ModelSource }): ModelConfig {
  return {
    ...models,
    detInputSize: 640,
    detStrides: [8, 16, 32],
    detNumAnchors: 2,
    detInputMean: 127.5,
    detInputStd: 128.0,
    arcInputSize: 112,
    arcInputMean: 127.5,
    arcInputStd: 127.5,
    detThresh: 0.5,
    nmsThresh: 0.4,
  }
}
