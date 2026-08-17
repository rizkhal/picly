// Mobile model loading — resolves the bundled ONNX assets (in
// mobile/assets/, synced from the shared root /models by scripts/sync-models.mjs)
// to a path on the local filesystem that onnxruntime-react-native can load.
//
// Files are declared with `require('./assets/<file>.onnx')` so Metro
// bundles them. On first access we downloadAsync() them from the app bundle
// into the cache directory (a no-op when they are already there), then feed the
// resulting file uri to the ORT backend.
//
// The .onnx files are LARGE and gitignored — see root /models (source of truth).

import * as FileSystem from 'expo-file-system/legacy';
import { Asset } from 'expo-asset';

export interface MobileModels {
  detModel: string;
  arcModel: string;
  qualityModel: string;
}

export interface LoadedModels {
  detModel: string;
  arcModel: string;
  qualityModel: string;
}

const MODEL_FILES = {
  detModel: require('../../assets/det_10g.onnx'),
  arcModel: require('../../assets/w600k_r50.onnx'),
  qualityModel: require('../../assets/ediffiqa_t.onnx'),
} as const satisfies Record<keyof MobileModels, number>;

// A bare (non-tagged) directory uri in expo-file-system is 'file:///...' with a
// trailing slash. onnxruntime-react-native accepts plain file paths.
function ensureSlash(p: string): string {
  return p.endsWith('/') ? p : p + '/';
}

let modelPromise: Promise<LoadedModels> | null = null;

/** True when the three ONNX bundles have been copied to the cache dir. */
export async function areModelsReady(): Promise<boolean> {
  try {
    await getModels();
    return true;
  } catch {
    return false;
  }
}

/**
 * Download the bundled model assets to the cache directory (idempotent) and
 * return their local file paths. The first call does the extraction; later
 * calls reuse the same resolved paths.
 */
export async function getModels(): Promise<LoadedModels> {
  if (!modelPromise) {
    modelPromise = (async () => {
      const dir = ensureSlash(FileSystem.cacheDirectory + 'picly-models');
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
      const entries = Object.entries(MODEL_FILES) as Array<[keyof MobileModels, number]>;
      const out: Partial<LoadedModels> = {};
      for (const [key, moduleId] of entries) {
        const asset = Asset.fromModule(moduleId);
        const localUri = asset.localUri ?? (await asset.downloadAsync()).localUri;
        if (!localUri) throw new Error(`Failed to resolve bundled model asset: ${key}`);
        // Copy into our own dir so the path is stable across launches
        // (downloadAsync can return a temp/cache uri that gets evicted).
        const dest = dir + asset.name + '.onnx';
        await FileSystem.copyAsync({ from: localUri, to: dest }).catch(() => {});
        out[key] = dest;
      }
      return out as LoadedModels;
    })();
  }
  return modelPromise;
}
