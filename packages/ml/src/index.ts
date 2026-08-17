/**
 * picly-ml — cross-platform face ML pipeline (detection + quality + embedding).
 *
 * Desktop (onnxruntime-node + sharp) and mobile (onnxruntime-react-native +
 * expo) share this exact implementation. Runtime concerns (model loading,
 * image decoding) are injected via the OrtBackend + ImageDecoder interfaces.
 */

// Barrel of platform-neutral pipeline modules. Desktop-only helpers
// (desktop-models) are intentionally NOT re-exported here: mobile imports the
// barrel in Metro and `node:fs` would otherwise be pulled into the RN bundle.

export { FaceAnalysis, ARCFACE_DST, RE_DETECT_FACE_PX, NMS_IOU, type FaceAnalysisOptions, type DetectTimings, type DetectBreakdown } from './faceAnalysis'
export { ScrfdDetector, type ScrfDetResult } from './scrfd'
export { ArcFaceEmbedder } from './arcface'
export { QualityScorer } from './quality'
export { resizeBilinear, letterbox, toNchwBlob, warpAffine, cropFace, cropRegion } from './image'
export { umeyama, svd2, det2, type Mat2 } from './matrix'
export { buffaloL, type ModelConfig } from './config'
export type { DetectedFace, FacePose, FaceQuality, RgbImage } from './types'
export type { OrtBackend, OrtSessionLike, ImageDecoder, ModelSource } from './runtime/types'
