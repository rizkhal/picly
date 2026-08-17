/**
 * Desktop ML pipeline types — provided by the shared `picly-ml` package.
 * This file keeps the original module path (`./ml/types`) working for all
 * existing consumers (local.ts, scanner.ts, scripts/*.cjs) with zero changes.
 */
export type { DetectedFace, FacePose, FaceQuality, RgbImage } from 'picly-ml'

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
