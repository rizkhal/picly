// Mobile face pipeline — a singleton FaceAnalysis over the shared picly-ml
// package, wired with the React Native runtime adapters (onnxruntime-react-native
// for inference + expo-file-system/decoders for image decoding).
//
// Desktop and mobile now run the EXACT same detection -> quality gate ->
// conditional embedding code (packages/ml). Only the model sources and the
// image decoder differ (bundled assets + content:// uris here vs filesystem
// paths + sharp on desktop).

import { FaceAnalysis, type DetectedFace } from 'picly-ml';
import { reactNativeOrtBackend, reactNativeImageDecoder } from 'picly-ml/runtime/react-native';
import { getModels } from './models';

export type { DetectedFace };

let analysisPromise: Promise<FaceAnalysis> | null = null;

/** Singleton pipeline instance (models extracted once, sessions reused). */
export function getAnalysis(): Promise<FaceAnalysis> {
  if (!analysisPromise) {
    analysisPromise = (async () => {
      const models = await getModels();
      return FaceAnalysis.create({
        backend: reactNativeOrtBackend(),
        decoder: reactNativeImageDecoder(),
        models,
      });
    })();
  }
  return analysisPromise;
}

/**
 * Convenience: decode a uri and run the full pipeline on it.
 * Returns the detected faces plus the DECODED dimensions — the same oriented
 * space the boxes live in (EXIF-applied), which may differ from the
 * media-library width/height for rotated phone photos.
 */
export async function analyzePhoto(
  uri: string,
): Promise<{ detected: DetectedFace[]; width: number; height: number }> {
  const analysis = await getAnalysis();
  const img = await analysis.decodePublic(uri);
  const detected = await analysis.detectFromImagePublic(img);
  return { detected, width: img.width, height: img.height };
}

/** Decode only (no inference) — returns oriented pixel dims + RGB bytes. */
export async function decodePhoto(uri: string): Promise<{ width: number; height: number; data: Uint8Array }> {
  const analysis = await getAnalysis();
  return analysis.decodePublic(uri);
}

export async function warmup(): Promise<void> {
  await getAnalysis();
}
