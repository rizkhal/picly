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

/** Convenience: decode a uri and run the full pipeline on it. */
export async function analyzePhoto(uri: string): Promise<DetectedFace[]> {
  const analysis = await getAnalysis();
  return analysis.detect(uri);
}

export async function warmup(): Promise<void> {
  await getAnalysis();
}
