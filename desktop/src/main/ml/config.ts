/**
 * Desktop model configuration — the shared `picly-ml` package holds the
 * pipeline defaults (buffaloL / ModelConfig); this module keeps the desktop
 * model-path resolution (Electron resources dir or ~/.insightface) and the
 * LocalModels shape used by Settings -> Model.
 */
import path from 'node:path'
import { defaultModelsDir as sharedDefaultModelsDir } from 'picly-ml/dist/desktop-models'

export { buffaloL } from 'picly-ml'
export type { ModelConfig } from 'picly-ml'

/** Desktop model paths — same behavior as before (now backed by picly-ml). */
export function defaultModelsDir(): string {
  return sharedDefaultModelsDir()
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
