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
  /** Path to the eDifFIQA face-quality ONNX model (ediffiqa/ediffiqa_t.onnx). */
  qualityModel: string
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
      // resourcesPath is Electron-only — cast: @types/node doesn't know it,
      // the editor LSP (electron types) does.
      return path.join((process as any).resourcesPath, 'models')
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
    qualityModel: path.join(modelsDir, 'ediffiqa', 'ediffiqa_t.onnx'),
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

/**
 * The ML models actually present on disk (basename of each ONNX file).
 * Used by the Settings -> Model section to show what this install has, so it
 * can be compared against the update manifest (which may ship newer models).
 */
export interface LocalModels {
  detector: string | null
  recognizer: string | null
  quality: string | null
}

export function localModels(modelsDir: string = defaultModelsDir()): LocalModels {
  const fs = require('node:fs') as typeof import('node:fs')
  const pick = (file: string) => {
    try {
      return fs.existsSync(file) ? path.basename(file) : null
    } catch {
      return null
    }
  }
  return {
    detector: pick(path.join(modelsDir, 'buffalo_l', 'det_10g.onnx')),
    recognizer: pick(path.join(modelsDir, 'buffalo_l', 'w600k_r50.onnx')),
    quality: pick(path.join(modelsDir, 'ediffiqa', 'ediffiqa_t.onnx')),
  }
}
