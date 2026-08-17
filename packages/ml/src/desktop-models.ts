import { mkdirSync } from 'node:fs'
import path from 'node:path'

/**
 * Shared model paths — single source of truth at the monorepo root `models/`
 * (used by both desktop and mobile). Resolution order:
 *   1. PICLY_MODELS_DIR env override
 *   2. Electron packaged app  → <resources>/models (bundled by electron-builder)
 *   3. Dev/CLI                → <monorepo root>/models
 * Kept in the ml package so the runtime adapter is fully portable; the path
 * string is what gets passed to the node OrtBackend.
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

  // Compiled to packages/ml/dist/desktop-models.js → ../../../ = monorepo root.
  return path.resolve(__dirname, '../../../models')
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
