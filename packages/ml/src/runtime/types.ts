/**
 * Runtime abstraction over ONNX Runtime.
 *
 * Desktop uses onnxruntime-node, mobile uses onnxruntime-react-native. Both
 * expose the same `onnxruntime-common` API (InferenceSession + Tensor), so the
 * pipeline classes (scrfd/arcface/quality) only ever see this small interface
 * — the actual model loading (path vs bundled asset) is injected per platform.
 */
import type { InferenceSession, Tensor } from 'onnxruntime-common'

/** How to load a model in a given runtime: a filesystem path or a buffer. */
export type ModelSource = string | ArrayBuffer | Uint8Array

export interface OrtSessionLike {
  readonly inputNames: readonly string[]
  readonly outputNames: readonly string[]
  run(
    feeds: Record<string, Tensor>,
    fetches?: readonly string[],
  ): Promise<Record<string, Tensor>>
}

/** Minimal surface both ONNX runtimes satisfy (node + react-native). */
export interface OrtBackend {
  createSession(
    source: ModelSource,
    options?: InferenceSession.SessionOptions,
  ): Promise<OrtSessionLike>
}

/**
 * Decode an image (filesystem path / uri) to raw RGB. Desktop decodes with
 * sharp; mobile fetches the asset uri and decodes via expo-image-manipulator
 * or a manual JPEG/PNG decoder. EXIF orientation is intentionally NOT applied
 * (matches cv2.imread, the Python reference).
 */
export interface ImageDecoder {
  decode(source: string): Promise<{ width: number; height: number; data: Uint8Array }>
}
