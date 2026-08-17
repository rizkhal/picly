// ============================================================================
// Picly Shared Types
// TypeScript interfaces used across desktop + mobile apps.
// ============================================================================

/** A detected face with bounding box and embedding. */
export interface Face {
  /** Unique identifier (UUID). */
  id: string;

  /** Image file path (desktop) or URI (mobile). */
  imagePath: string;

  /** Bounding box [x, y, width, height] in pixels. */
  bbox: [number, number, number, number];

  /** Embedding vector (512-dim for ArcFace). */
  embedding: number[];

  /** Face quality score 0-1 (higher = better). */
  quality: number;

  /** Detection timestamp (ms). */
  detectedAt: number;

  /** Optional metadata from image decoder. */
  metadata?: FaceMetadata;
}

/** Metadata from image decode. */
export interface FaceMetadata {
  /** Original image width. */
  width: number;
  /** Original image height. */
  height: number;
  /** Image format (jpeg, png, webp). */
  format: string;
  /** Image orientation (0-360 degrees). */
  orientation: number;
}

/** A person (cluster of faces). */
export interface Person {
  /** Unique identifier (UUID). */
  id: string;

  /** Display name. */
  name: string;

  /** Representative face ID (centroid). */
  representativeFaceId?: string;

  /** Number of faces in this cluster. */
  faceCount: number;

  /** Average quality across faces. */
  avgQuality: number;

  /** First seen timestamp. */
  firstSeen: number;

  /** Last seen timestamp. */
  lastSeen: number;
}

/** A folder of images to scan. */
export interface ScanFolder {
  /** Unique identifier (UUID). */
  id: string;

  /** Display name (folder name). */
  name: string;

  /** Path to folder (absolute path on desktop, URI on mobile). */
  path: string;

  /** Whether folder is currently accessible. */
  available: boolean;

  /** Total images found. */
  imageCount?: number;

  /** Faces detected (total). */
  faceCount?: number;

  /** Persons clustered. */
  personCount?: number;

  /** Last scan timestamp. */
  lastScanned?: number;

  /** Scan errors (if any). */
  errors?: ScanError[];
}

/** Scan error details. */
export interface ScanError {
  /** File path that caused error. */
  path: string;

  /** Error message. */
  message: string;

  /** Error type. */
  type: 'decode' | 'detect' | 'embed' | 'scan' | 'unknown';
}

/** Cluster merge operation (for manual merge UI). */
export interface ClusterMerge {
  /** Target person ID (result). */
  targetId: string;

  /** Source person ID (to merge into target). */
  sourceId: string;

  /** Timestamp of merge. */
  mergedAt: number;
}

/** Cluster split operation (for manual split UI). */
export interface ClusterSplit {
  /** Original person ID. */
  personId: string;

  /** New person ID for split portion. */
  newPersonId: string;

  /** Face IDs moved to new person. */
  faceIds: string[];

  /** Timestamp of split. */
  splitAt: number;
}

// ============================================================================
// Barrel exports
// ============================================================================

export * from './types';
