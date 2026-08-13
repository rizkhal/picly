export interface RgbImage {
  width: number
  height: number
  /** Row-major RGB, length width * height * 3. */
  data: Uint8Array
}

/**
 * Quality tier for a detected face. Detection, quality, recognition and
 * clustering are separate stages: a tiny/low-quality face is still a valid
 * detection (shown in UI) but should not drive recognition/clustering.
 */
export type FaceQuality = 'high' | 'medium' | 'low' | 'very_low'

export interface DetectedFace {
  /** [x1, y1, x2, y2] in original-image coordinates (float). */
  bbox: [number, number, number, number]
  detScore: number
  /** 5 landmarks (raw from the detector, not refined), original-image coords. */
  kps: number[][]
  /**
   * L2-normalized ArcFace embedding (512-d). NULL when the face is below the
   * embedding threshold (very_low quality) and embedding was skipped — the
   * face is still a valid detection for UI, but can't drive recognition.
   */
  embedding: Float32Array | null
  /** Quality tier from the quality gate (size + score + landmarks). */
  quality: FaceQuality
  /** Continuous quality score, 0..1 (see FaceAnalysis.qualityScore). */
  qualityScore: number
  /** true for very_low tier (below embedding threshold). */
  lowQuality: boolean
}

/** Golden fixture shape produced by docs/ml-parity/gen_fixtures.py (Python insightface reference). */
export interface GoldenFixtureFace {
  bbox: number[]
  det_score: number
  kps: number[][]
  /** 2x3 similarity transform from estimate_norm(raw kps). */
  M: number[][]
  /** Embedding target computed from raw kps (what the Node pipeline must match). */
  embedding: number[]
  /** App-standard embedding (2d106det-refined kps) — informational only. */
  ref_embedding: number[] | null
}

export interface GoldenFixturePhoto {
  photo: string
  width: number
  height: number
  faces: GoldenFixtureFace[]
}

export interface GoldenFixture {
  generated_by: string
  reference: string
  photos: GoldenFixturePhoto[]
}
