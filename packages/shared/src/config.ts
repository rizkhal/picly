// ============================================================================
// Picly Shared Config
// Central config used by desktop (Electron) + mobile (Expo) apps.
// ============================================================================

export const MODEL_CONFIG = {
  /** Path to ONNX face detection model (SCRFD). */
  detectionModelPath: './models/scrd_500m.onnx',

  /** Path to ONNX face recognition model (ArcFace). */
  recognitionModelPath: './models/arcface_r100.onnx',

  /** Number of output channels from recognition model. */
  embeddingDim: 512,

  /** Minimum face size to process (px). Smaller faces skipped. */
  minFaceSize: 56,

  /** Maximum faces per image to process. -1 = unlimited. */
  maxFacesPerImage: -1,

  /** Whether to apply letterbox padding for non-square images. */
  letterbox: true,
} as const;

export const CLUSTERING_CONFIG = {
  /** Similarity threshold for centroid-linkage merge. */
  mergeThreshold: 0.5,

  /** Minimum similarity for a face to participate in clustering.
   * Low-quality faces below this are isolated (LOW_JOIN_SIM). */
  lowJoinSim: 0.6,

  /** Maximum number of clusters to return. -1 = unlimited. */
  maxClusters: -1,

  /** When true, skip faces with quality < minQuality. */
  skipLowQuality: true,

  /** Minimum embedding quality score (0-1). */
  minQuality: 0.25,
} as const;

export const DB_CONFIG = {
  /** SQLite database file path (relative to app data dir). */
  dbPath: './picly.db',

  /** Create tables if not exist on startup. */
  autoMigrate: true,
} as const;

export const CACHE_CONFIG = {
  /** Directory for thumbnail cache. */
  thumbnailDir: './thumbnails',

  /** Max thumbnail file size (bytes). */
  maxThumbnailSize: 512 * 1024, // 512KB

  /** JPEG quality for cached thumbnails (1-100). */
  thumbnailQuality: 85,
} as const;

export const APP_CONFIG = {
  /** App name displayed in UI. */
  appName: 'Picly',

  /** Version (synced with package.json version). */
  version: '1.0.0',

  /** Developer/org name. */
  author: 'Rizkal',
} as const;

// ============================================================================
// Barrel exports
// ============================================================================

export * from './config';
