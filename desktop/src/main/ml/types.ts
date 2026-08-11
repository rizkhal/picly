export interface RgbImage {
  width: number
  height: number
  /** Row-major RGB, length width * height * 3. */
  data: Uint8Array
}

export interface DetectedFace {
  /** [x1, y1, x2, y2] in original-image coordinates (float). */
  bbox: [number, number, number, number]
  detScore: number
  /** 5 landmarks (raw from the detector, not refined), original-image coords. */
  kps: number[][]
  /** L2-normalized ArcFace embedding (512-d). */
  embedding: Float32Array
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
