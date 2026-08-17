// ============================================================================
// Picly Shared — Barrel Export
// ============================================================================

// Config — sourced from the shared ML package (single source of truth).
export { MODEL_CONFIG, QUALITY_CONFIG, CLUSTERING_CONFIG, DB_CONFIG, CACHE_CONFIG, APP_CONFIG } from './config';

// ML pipeline types + helpers (picly-ml) — re-exported so consumers can use
// one package for both config and the face pipeline.
export type {
  DetectedFace,
  FacePose,
  FaceQuality,
  RgbImage,
  OrtBackend,
  OrtSessionLike,
  ImageDecoder,
  ModelSource,
} from 'picly-ml';

// Types
export type {
  Face,
  FaceMetadata,
  Person,
  ScanFolder,
  ScanError,
  ClusterMerge,
  ClusterSplit,
} from './types';
