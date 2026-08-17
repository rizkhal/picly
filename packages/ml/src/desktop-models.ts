import { mkdirSync } from 'node:fs'
import path from 'node:path'

/**
 * Desktop model paths — Electron-aware, same resolution as the original
 * desktop/src/main/ml/config.ts. Kept in the ml package so the runtime
 * adapter is fully portable; the path string is what gets passed to the
 * node OrtBackend.
 */
export function defaultModelsDir(): string {
  if (process.env.PICLY_MODELS_DIR) return process.env.PICLY_MODELS_DIR

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron')
    if (electron?.app?.isPackaged) {
      return path.join((process as any).resourcesPath, 'models')
    }
  } catch {
    // Not running inside Electron (CLI tests) — fall through.
  }

  return path.join(require('node:os').homedir(), '.insightface', 'models')
}

export function defaultDesktopModels(modelsDir?: string): { detModel: string; arcModel: string; qualityModel: string } {
  const dir = modelsDir ?? defaultModelsDir()
  return {
    detModel: path.join(dir, 'buffalo_l', 'det_10g.onnx'),
    arcModel: path.join(dir, 'buffalo_l', 'w600k_r50.onnx'),
    qualityModel: path.join(dir, 'ediffiqa', 'ediffiqa_t.onnx'),
  }
}

/** Make sure the models dir exists (desktop-only helper; mobile passes buffers). */
export function ensureModelsDir(): void {
  mkdirSync(path.join(defaultModelsDir(), 'buffalo_l'), { recursive: true })
  mkdirSync(path.join(defaultModelsDir(), 'ediffiqa'), { recursive: true })
}
