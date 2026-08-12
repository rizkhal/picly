import os from 'node:os'
import path from 'node:path'

/**
 * Model + preprocessing configuration for the face pipeline.
 * Config-driven on purpose: swapping to a lighter model pack (e.g. buffalo_s)
 * later only means changing these values — the pipeline code stays the same.
 */
export interface ModelConfig {
  /** Path to the SCRFD detection ONNX model (e.g. buffalo_l/det_10g.onnx). */
  detModel: string
  /** Path to the ArcFace recognition ONNX model (e.g. buffalo_l/w600k_r50.onnx). */
  arcModel: string
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

export function defaultModelsDir(): string {
  if (process.env.PICLY_MODELS_DIR) return process.env.PICLY_MODELS_DIR

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron')
    if (electron?.app?.isPackaged) {
      // @ts-expect-error resourcesPath is provided by Electron, not @types/node
      return path.join(process.resourcesPath, 'models')
    }
  } catch {
    // Not running inside Electron (CLI tests) — fall through.
  }

  return path.join(os.homedir(), '.insightface', 'models')
}

export function buffaloL(modelsDir: string = defaultModelsDir()): ModelConfig {
  return {
    detModel: path.join(modelsDir, 'buffalo_l', 'det_10g.onnx'),
    arcModel: path.join(modelsDir, 'buffalo_l', 'w600k_r50.onnx'),
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
