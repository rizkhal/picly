// ============================================================================
// Picly Shared Config
// Central config used by desktop (Electron) + mobile (Expo) apps.
//
// ⚠️ Source of truth: these numbers mirror the BENCHMARKED production defaults
// in desktop/src/main (detection frozen, quality gating validated, clustering
// tuned to 0.45 on LFW + psdkp crowded photos). Keep in sync when the desktop
// pipeline changes — see desktop/src/main/ml/faceAnalysis.ts + db/store.ts.
// ============================================================================

export const MODEL_CONFIG = {
  /** Face detection model (SCRFD 10G, insightface buffalo_l). */
  detectionModel: 'det_10g',

  /** Face recognition model (ArcFace w600k_r50, insightface buffalo_l). */
  recognitionModel: 'w600k_r50',

  /** Face quality model (eDifFIQA). */
  qualityModel: 'ediffiqa_t',

  /** Embedding dimension produced by the recognition model. */
  embeddingDim: 512,

  /** Detector input size (long side, letterboxed). */
  detSize: 640,

  /** Confidence threshold — full-image pass (benchmarked 0.5). */
  fullDetThresh: 0.5,

  /** Confidence threshold — tiled re-detection pass (same default). */
  tileDetThresh: 0.5,

  /** Faces smaller than this (px, original image) trigger tile refinement. */
  reDetectFacePx: 80,

  /** IoU for cross-stage duplicate suppression (NMS). */
  nmsIou: 0.3,

  /** Overlap between adjacent tiles (0 — benchmark showed no recall gain). */
  tileOverlap: 0,

  /** Minimum face bbox side to pass the quality gate (px). */
  minFacePx: 16,

  /** Minimum detection score to pass the quality gate. */
  minFaceScore: 0.3,
} as const;

export const QUALITY_CONFIG = {
  /** Composite gate: (detScore < detScoreGate && eqScore < eqScoreGate) → very_low. */
  qualityGateDetScore: 0.5,
  qualityGateEqScore: 0.25,

  /** Tiny arm: side < tinySidePx && eqScore < eqTiny → very_low. */
  qualityGateTinySidePx: 80,
  qualityGateEqTiny: 0.15,

  /** Global eDifFIQA floor for embedding. */
  qualityScoreMin: 0.2,

  /** Extra blur floor (eDifFIQA < this → rejected from recognition). */
  qualityBlurEq: 0.15,

  /** Tier boundaries (min bbox side, px). */
  tiers: {
    high: 64,
    medium: 32,
    low: 20,
  },

  /** VERY_LOW faces are skipped for embedding by default. */
  embedLow: false,

  /** Hide persons whose average eDifFIQA is below this. */
  minAvgQuality: 0.3,
} as const;

export const CLUSTERING_CONFIG = {
  /** HAC average-linkage cutoff. PRODUCTION DEFAULT: 0.45 (tuned 2026-08;
   *   recall 0.960→0.975 vs 0.50 at +0.05% false-merge). Rollback: 0.50. */
  mergeThreshold: 0.45,

  /** LOW-quality faces must beat this to join an existing cluster. */
  lowJoinSim: 0.6,

  /** Search / matching minimum similarity. */
  searchMinSim: 0.5,

  /** Hide single-photo/single-face persons by default (showSingletons=false). */
  showSingletons: false,

  /** Maximum clusters to return (-1 = unlimited). */
  maxClusters: -1,
} as const;

export const DB_CONFIG = {
  /** SQLite database file name (relative to the app data dir). */
  dbPath: 'picly.db',

  /** Create tables if not exist on startup. */
  autoMigrate: true,
} as const;

export const CACHE_CONFIG = {
  /** Directory for the thumbnail cache. */
  thumbnailDir: './thumbnails',

  /** Max thumbnail file size (bytes). */
  maxThumbnailSize: 512 * 1024, // 512KB

  /** JPEG quality for cached thumbnails (1-100). */
  thumbnailQuality: 85,
} as const;

export const APP_CONFIG = {
  /** App name displayed in the UI. */
  appName: 'Picly',

  /** Version (synced with package.json version). */
  version: '1.0.1',

  /** Developer/org name. */
  author: 'Rizkal',
} as const;
