import { cropRegion, letterbox, warpAffine } from './image'
import { umeyama } from './matrix'
import { ArcFaceEmbedder } from './arcface'
import { QualityScorer } from './quality'
import { ScrfdDetector } from './scrfd'
import type { DetectedFace, FacePose, FaceQuality, RgbImage } from './types'
import type { ImageDecoder, ModelSource, OrtBackend } from './runtime/types'
import { buffaloL, type ModelConfig } from './config'

/** ArcFace alignment template (arcface_dst from insightface/utils/face_align.py). */
export const ARCFACE_DST: number[][] = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
]

/**
 * Two-stage detection, mirroring insightface's FaceAnalysis small-face
 * refinement (tiled re-detection):
 *
 *   ORIGINAL PHOTO
 *        │
 *        ▼
 *   SCRFD-10GF @ 640          <- pass 1, full image (fullDetThresh)
 *        │
 *   ┌────┴────────────────┐
 *   │                     │
 * faces ok          tiny OR crowded OR low-conf
 *   │                     │
 *   ▼                     ▼
 *  accept          2×2 tiles, 20% overlap (tileDetThresh)
 *                         │
 *                   still tiny?
 *                         │
 *                         ▼
 *                   3×3 tiles, 20% overlap
 *                         │
 *                         ▼
 *                   merge + NMS (cross-scale duplicate suppression)
 *                         │
 *                         ▼
 *                  QUALITY GATE (size + score + landmark sanity)
 *                         │
 *                         ▼
 *                   Buffalo_L (embed aligned faces)
 *
 * Design notes (from psdkp-sample-tile benchmarks):
 * - Full & tile detectors have SEPARATE thresholds: full can stay permissive,
 *   tiles run at a higher bar so upscaled background does not turn into
 *   false positives (Failure A: DSC02048 87 detections for ~30 faces).
 * - Tiling is triggered not only by tiny bboxes but also by crowded scenes
 *   (Failure B: DSC02166 got 0 tile runs because every face was >= 80px).
 * - Tiles overlap 20% so faces straddling a tile border are fully visible in
 *   at least one tile (fewer cut-in-half misses/duplicates).
 * - Every candidate passes a quality gate before Buffalo_L: bbox size,
 *   score, and landmark sanity. Weak/tiny candidates never reach recognition.
 *
 * All knobs are configurable via FaceAnalysisOptions for controlled tuning.
 */
export const RE_DETECT_FACE_PX = 80
export const NMS_IOU = 0.3

export interface FaceAnalysisOptions {
  /** Runtime backend (onnxruntime-node on desktop / react-native on mobile). */
  backend: OrtBackend
  /** Decodes a source (path / uri) into raw RGB. */
  decoder: ImageDecoder
  /** Model sources (filesystem paths on desktop, bundled assets/buffers on mobile). */
  models: { detModel: ModelSource; arcModel: ModelSource; qualityModel: ModelSource }
  detSize?: number
  /** Confidence threshold for the full-image pass (default 0.5). */
  fullDetThresh?: number
  /** Confidence threshold for tile re-detection (default 0.5; tune 0.35-0.6). */
  tileDetThresh?: number
  /** Faces smaller than this (px, original image) trigger tile refinement. */
  reDetectFacePx?: number
  /** IoU for cross-stage duplicate suppression (default 0.3; try 0.4/0.5). */
  nmsIou?: number
  /** Overlap fraction between adjacent tiles (default 0 — benchmark showed overlap doesn't improve recall). */
  tileOverlap?: number
  /** Minimum face bbox side to pass the quality gate (default 16px). */
  minFacePx?: number
  /** Minimum detection score to pass the quality gate (default 0.3). */
  minFaceScore?: number
  /** Skip ArcFace embedding (detection-only, for tuning experiments). */
  embed?: boolean
  /** Also embed faces below the embedding threshold (low/very_low). Default false. */
  embedLow?: boolean
  /**
   * Composite quality gate (eDifFIQA + detection score). Faces matching the
   * condition are downgraded to very_low: they stay visible in the UI but
   * don't get embedded / don't drive clustering (protects against phantom
   * clusters from blur / non-face crops like Person 41).
   */
  qualityScoreMin?: number
  /** Detection-score arm of the gate (default 0.7). */
  qualityGateDetScore?: number
  /** eDifFIQA threshold for the det-score arm (default 0.25). */
  qualityGateEqScore?: number
  /** Tiny-face arm: side below this AND eDifFIQA below qualityGateEqTiny. */
  qualityGateTinySidePx?: number
  /** eDifFIQA threshold for the tiny-face arm (default 0.15). */
  qualityGateEqTiny?: number
  /**
   * Blur arm: faces with eDifFIQA below this are additionally downgraded one
   * tier (and never rated high), because a blurry crop is weak evidence of an
   * identity. Default 0.15 — under it a 64px+ crop falls to medium, under the
   * min it falls to low. Set to 0 to disable.
   */
  qualityBlurEq?: number
  /** Log per-stage detection details to console (tuning/debug). */
  debugLog?: boolean
}

interface RawDet {
  bboxes: number[][]
  scores: number[]
  kpss: number[][][]
}

export interface DetectTimings {
  fullImageMs: number
  tileMs: number
  embedMs: number
  tileRuns: number
}

/** Per-stage detection counts for the RAW -> NMS -> QUALITY -> FINAL report. */
export interface DetectBreakdown {
  /** Detections from the full-image pass (pre-NMS). */
  rawFull: number
  /** Detections from all tile passes combined (pre-NMS). */
  rawTile: number
  /** Kept after cross-source NMS. */
  afterNms: number
  /** Kept after the quality gate. */
  afterGate: number
  /** Faces actually embedded/returned. */
  final: number
  /** Gate rejections by reason. */
  rejectedTiny: number
  rejectedScore: number
  rejectedKps: number
  /** Faces downgraded to very_low by the eDifFIQA quality gate (not embedded). */
  qualityDowngraded: number
}

/**
 * Face detection + embedding pipeline, mirroring insightface's FaceAnalysis
 * (buffalo_l, det_size 640) but running fully via ONNX Runtime:
 *   SCRFD detect -> estimate_norm(raw kps) -> warp 112x112 -> ArcFace -> L2 norm.
 *
 * Platform-neutral: the OrtBackend + ImageDecoder + model sources are injected,
 * so desktop (onnxruntime-node / sharp) and mobile (onnxruntime-react-native /
 * expo) share this exact implementation.
 */
export class FaceAnalysis {
  private detector: ScrfdDetector
  private embedder: ArcFaceEmbedder
  private config: ModelConfig
  private backend: OrtBackend
  private models: { detModel: ModelSource; arcModel: ModelSource; qualityModel: ModelSource }
  private decoder: ImageDecoder
  private detSize: number
  private fullDetThresh: number
  private tileDetThresh: number
  private reDetectFacePx: number
  private nmsIou: number
  private tileOverlap: number
  private minFacePx: number
  private minFaceScore: number
  private embed: boolean
  private embedLow: boolean
  private qualityScoreMin: number
  private qualityGateDetScore: number
  private qualityGateEqScore: number
  private qualityGateTinySidePx: number
  private qualityGateEqTiny: number
  private qualityBlurEq: number
  /** Lazy quality scorer (eDifFIQA) — created on first use. */
  private qualityScorer: QualityScorer | null = null
  /** Timing of the last detectFromImage call (per-stage breakdown). */
  lastTimings: DetectTimings | null = null
  /** Detection counts of the last detectFromImage call. */
  lastBreakdown: DetectBreakdown | null = null
  private debugLog: boolean = false

  private constructor(
    detector: ScrfdDetector,
    embedder: ArcFaceEmbedder,
    config: ModelConfig,
    backend: OrtBackend,
    models: { detModel: ModelSource; arcModel: ModelSource; qualityModel: ModelSource },
    decoder: ImageDecoder,
    detSize: number,
    fullDetThresh: number,
    tileDetThresh: number,
    reDetectFacePx: number,
    nmsIou: number,
    tileOverlap: number,
    minFacePx: number,
    minFaceScore: number,
    embed: boolean,
    embedLow: boolean,
    qualityScoreMin: number,
    qualityGateDetScore: number,
    qualityGateEqScore: number,
    qualityGateTinySidePx: number,
    qualityGateEqTiny: number,
    qualityBlurEq: number,
    debugLog: boolean,
  ) {
    this.detector = detector
    this.embedder = embedder
    this.config = config
    this.backend = backend
    this.models = models
    this.decoder = decoder
    this.detSize = detSize
    this.fullDetThresh = fullDetThresh
    this.tileDetThresh = tileDetThresh
    this.reDetectFacePx = reDetectFacePx
    this.nmsIou = nmsIou
    this.tileOverlap = tileOverlap
    this.minFacePx = minFacePx
    this.minFaceScore = minFaceScore
    this.embed = embed
    this.embedLow = embedLow ?? false
    this.qualityScoreMin = qualityScoreMin ?? 0.2
    this.qualityGateDetScore = qualityGateDetScore ?? 0.5
    this.qualityGateEqScore = qualityGateEqScore ?? 0.25
    this.qualityGateTinySidePx = qualityGateTinySidePx ?? 80
    this.qualityGateEqTiny = qualityGateEqTiny ?? 0.15
    this.qualityBlurEq = qualityBlurEq ?? 0.15
    this.debugLog = debugLog ?? false
  }

  static async create(options: FaceAnalysisOptions): Promise<FaceAnalysis> {
    const { backend, decoder, models, debugLog, ...rest } = options
    const config = buffaloL(models)
    const detector = await ScrfdDetector.create(config, backend, models.detModel)
    const embedder = await ArcFaceEmbedder.create(config, backend, models.arcModel)
    const instance = new FaceAnalysis(
      detector,
      embedder,
      config,
      backend,
      models,
      decoder,
      rest.detSize ?? 640,
      rest.fullDetThresh ?? config.detThresh,
      rest.tileDetThresh ?? config.detThresh,
      rest.reDetectFacePx ?? RE_DETECT_FACE_PX,
      rest.nmsIou ?? NMS_IOU,
      rest.tileOverlap ?? 0,
      rest.minFacePx ?? 16,
      rest.minFaceScore ?? 0.3,
      rest.embed ?? true,
      rest.embedLow ?? false,
      rest.qualityScoreMin === undefined ? 0.2 : rest.qualityScoreMin,
      rest.qualityGateDetScore ?? 0.5,
      rest.qualityGateEqScore ?? 0.25,
      rest.qualityGateTinySidePx ?? 80,
      rest.qualityGateEqTiny ?? 0.15,
      rest.qualityBlurEq ?? 0.15,
      debugLog ?? false,
    )
    instance.debugLog = debugLog ?? false
    return instance
  }

  async detect(source: string): Promise<DetectedFace[]> {
    const img = await this.decoder.decode(source)
    return this.detectFromImage(img)
  }

  /**
   * Public helper for tools/scripts: warp an aligned 112x112 RGB crop from raw
   * SCRFD kps (same transform `embedFace` uses). Returns a copy so callers own
   * the buffer.
   */
  async warpAlignedPublic(img: RgbImage, kps: number[][]): Promise<RgbImage> {
    const M = umeyama(kps, ARCFACE_DST)
    const aimg = warpAffine(img, M, this.config.arcInputSize)
    return { width: aimg.width, height: aimg.height, data: new Uint8Array(aimg.data) }
  }

  /** Run SCRFD once over `img`, coords in img-local space. */
  private async runDetector(img: RgbImage, detSize: number, detThresh: number): Promise<RawDet> {
    const { resized, detScale } = letterbox(img, detSize)
    const res = await this.detector.detect(resized, detSize, detThresh, detScale)
    return { bboxes: res.bboxes, scores: res.scores, kpss: res.kpss }
  }

  /**
   * Tile the FULL image into an n×n grid with `tileOverlap` overlap and run
   * SCRFD on each tile at `detThresh`. Tile width = w / (n - (n-1)*overlap),
   * so consecutive tiles share exactly `overlap` of their width/height.
   * Returns detections with coords mapped back to ORIGINAL image space.
   */
  private async detectTiled(img: RgbImage, n: number, detThresh: number): Promise<RawDet> {
    const w = img.width
    const h = img.height
    const r = this.tileOverlap
    const tileW = w / (n - (n - 1) * r)
    const tileH = h / (n - (n - 1) * r)
    const out: RawDet = { bboxes: [], scores: [], kpss: [] }
    for (let ty = 0; ty < n; ty++) {
      for (let tx = 0; tx < n; tx++) {
        const bx1 = Math.floor(tx * (1 - r) * tileW)
        const by1 = Math.floor(ty * (1 - r) * tileH)
        const bx2 = tx === n - 1 ? w : Math.min(w, Math.ceil(bx1 + tileW))
        const by2 = ty === n - 1 ? h : Math.min(h, Math.ceil(by1 + tileH))
        const tile = cropRegion(img, [bx1, by1, bx2, by2])
        const det = await this.runDetector(tile, this.detSize, detThresh)
        for (let i = 0; i < det.bboxes.length; i++) {
          out.bboxes.push([bx1 + det.bboxes[i][0], by1 + det.bboxes[i][1], bx1 + det.bboxes[i][2], by1 + det.bboxes[i][3]])
          out.scores.push(det.scores[i])
          out.kpss.push(det.kpss[i].map(([x, y]) => [bx1 + x, by1 + y]))
        }
      }
    }
    return out
  }

  /**
   * Decide whether to tile and at what grid, from pass-1 results.
   * Tiles run when faces are tiny (< reDetectFacePx) OR the scene is crowded
   * (many faces — group photos hide small faces from the full pass even when
   * the detected ones are large). A scene with no faces skips tiling entirely.
   */
  private planTiling(img: RgbImage, pass1: RawDet): 0 | 2 {
    const nFaces = pass1.bboxes.length
    if (nFaces === 0) return 0
    const hasTiny = pass1.bboxes.some((b) => b[2] - b[0] < this.reDetectFacePx)
    const areaMpx = (img.width * img.height) / 1e6
    const crowded = nFaces >= 6 || (nFaces >= 3 && areaMpx <= 4)
    return hasTiny || crowded ? 2 : 0
  }

  /** After 2×2 tiles, refine to 3×3 only while genuinely tiny faces remain. */
  private shouldRefine(merged: RawDet): boolean {
    return merged.bboxes.some((b) => b[2] - b[0] < this.reDetectFacePx)
  }

  /**
   * Landmark sanity for the quality gate. Conservative on purpose: we do NOT
   * reject profile/angled faces, only geometrically impossible ones (non-finite
   * points, landmarks far outside the bbox). Small faces legitimately have
   * closely-spaced eyes, so eye distance is NOT used as a hard rejection —
   * benchmark showed it wrongly dropped real small faces in crowded scenes.
   */
  private static faceGeometry(bbox: number[], kps: number[][]): { valid: boolean; eyeDistRatio: number; yawRatio: number } {
    const bad = { valid: false, eyeDistRatio: 0, yawRatio: 0 }
    if (!kps || kps.length !== 5) return bad
    const [x1, y1, x2, y2] = bbox
    const bw = Math.max(1, x2 - x1)
    const bh = Math.max(1, y2 - y1)
    const pad = 0.9 // landmarks may sit just outside the tight bbox
    for (const p of kps) {
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return bad
      if (p[0] < x1 - pad * bw || p[0] > x2 + pad * bw) return bad
      if (p[1] < y1 - pad * bh || p[1] > y2 + pad * bh) return bad
    }
    const re = kps[0]
    const le = kps[1]
    const nose = kps[2]
    const eyeDist = Math.hypot(re[0] - le[0], re[1] - le[1])
    const eyeMid = [(re[0] + le[0]) / 2, (re[1] + le[1]) / 2]
    // Proportional eye-distance sanity: a real face always has eyes spanning a
    // meaningful fraction of its box. Proportional (not absolute) so small faces
    // are not wrongly rejected.
    const eyeDistRatio = eyeDist / Math.max(1, Math.min(bw, bh))
    // Yaw proxy from nose offset vs eye midpoint (normalized by eye distance).
    // 0 = frontal; |yaw| large = strong profile (weak ArcFace evidence).
    const yawRatio = eyeDist > 0 ? (nose[0] - eyeMid[0]) / eyeDist : 0
    if (eyeDistRatio < 0.04) return bad
    return { valid: true, eyeDistRatio, yawRatio }
  }

  /**
   * Pose-aware quality penalty. Faces with strong yaw (profile/back-of-head)
   * produce weak ArcFace evidence and can false-match a different person, so
   * they are downgraded one tier — they stay visible in the UI but no longer
   * anchor clustering. 0 = frontal, returns 0..n tiers to drop.
   */
  private static posePenalty(yawRatio: number, eyeDistRatio: number): number {
    const absYaw = Math.abs(yawRatio)
    // Very strong profile or degenerate landmarks (eyes too close together for
    // the box) — treat as weak identity evidence.
    if (absYaw > 1.6 || eyeDistRatio < 0.08) return 1
    return 0
  }

  /**
   * Composite FP gate: mid-confidence detections that are too small to be
   * genuine large faces are almost always non-face crops (back-of-head,
   * shoulder, texture). Real faces >=64px have detScore p5=0.571 and usually
   * grow beyond 250px; downgrading these to `low` keeps them in the UI but
   * stops them from anchoring clustering (LOW can only join with strong sim).
   */
  private fpAnglePenalty(bbox: number[], score: number): number {
    const side = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1])
    if (score < 0.6 && side < 250) return 2 // high|medium -> low (never anchor)
    return 0
  }

  private gateReason(bbox: number[], score: number, kps: number[][]): { reason: 'tiny' | 'score' | 'kps' | null; posePenalty: number; fpPenalty: number } {
    const bw = bbox[2] - bbox[0]
    const bh = bbox[3] - bbox[1]
    if (Math.min(bw, bh) < this.minFacePx) return { reason: 'tiny', posePenalty: 0, fpPenalty: 0 }
    if (score < this.minFaceScore) return { reason: 'score', posePenalty: 0, fpPenalty: 0 }
    const geom = FaceAnalysis.faceGeometry(bbox, kps)
    if (!geom.valid) return { reason: 'kps', posePenalty: 0, fpPenalty: 0 }
    return { reason: null, posePenalty: FaceAnalysis.posePenalty(geom.yawRatio, geom.eyeDistRatio), fpPenalty: this.fpAnglePenalty(bbox, score) }
  }

  /**
   * Continuous quality score 0..1 for a detection. Combines detection
   * confidence, landmark eye-distance (proportional), and bbox size — NOT size
   * alone (a 40px sharp face can outrank a blurry 90px one).
   */
  private qualityScore(bbox: number[], score: number, kps: number[][]): number {
    const bw = bbox[2] - bbox[0]
    const bh = bbox[3] - bbox[1]
    const side = Math.max(bw, bh)
    // Size component (0..1): 0 at 0px, saturates ~120px.
    const sizeComp = Math.min(1, side / 120)
    // Eye-distance component (0..1): proportional to bbox, saturates ~0.3.
    const eyeDist = Math.hypot(kps[0][0] - kps[1][0], kps[0][1] - kps[1][1])
    const eyeComp = Math.min(1, eyeDist / Math.max(1, 0.3 * Math.max(bw, bh)))
    // Confidence component (0..1): det score from 0.3..0.9.
    const confComp = Math.min(1, Math.max(0, (score - 0.3) / 0.6))
    // Weights: size matters most, then landmarks, then confidence.
    return Math.min(1, 0.45 * sizeComp + 0.35 * eyeComp + 0.2 * confComp)
  }

  /**
   * Quality tier from bbox size + quality score + (optional) eDifFIQA blur
   * score. Size bands first (high >= 64px, medium 32-64, low 20-32, very_low
   * < 20) then score-based promotion. When eqScore (eDifFIQA) is provided and
   * below qualityBlurEq the face is downgraded one tier and never rated high:
   * a blurry crop is weak evidence of an identity, even when it is large.
   */
  private classifyQuality(
    bbox: number[],
    score: number,
    kps: number[][],
    eqScore: number | null = null,
  ): { quality: FaceQuality; qualityScore: number; posePenalty: number } {
    const side = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1])
    const q = this.qualityScore(bbox, score, kps)
    let quality: FaceQuality
    if (side >= 64) quality = q >= 0.5 ? 'high' : 'medium'
    else if (side >= 32) quality = 'medium'
    else if (side >= 20) quality = q >= 0.45 ? 'low' : 'very_low'
    else quality = 'very_low'
    // Pose arm: strong profile / degenerate landmarks weaken identity evidence.
    const geom = FaceAnalysis.faceGeometry(bbox, kps)
    const posePenalty = FaceAnalysis.posePenalty(geom.yawRatio, geom.eyeDistRatio)
    if (posePenalty > 0) {
      const order: FaceQuality[] = ['high', 'medium', 'low', 'very_low']
      quality = order[Math.min(order.length - 1, Math.max(0, order.indexOf(quality) + posePenalty))]
    }
    // Blur arm: eDifFIQA below qualityBlurEq -> one tier down, never high.
    // Under half of qualityBlurEq (very blurry) -> one more tier down.
    if (eqScore !== null && this.qualityBlurEq > 0 && eqScore < this.qualityBlurEq) {
      const drop = eqScore < this.qualityBlurEq / 2 ? 2 : 1
      const order: FaceQuality[] = ['high', 'medium', 'low', 'very_low']
      const idx = order.indexOf(quality)
      quality = order[Math.min(order.length - 1, Math.max(0, idx + drop))]
    }
    return { quality, qualityScore: q, posePenalty }
  }

  /** Greedy NMS across all detections (dedup tiles + pass-1 overlap). */
  private nmsAll(dets: RawDet[]): RawDet {
    const allB: number[][] = []
    const allS: number[] = []
    const allK: number[][][] = []
    for (const d of dets) {
      for (let i = 0; i < d.bboxes.length; i++) {
        allB.push(d.bboxes[i])
        allS.push(d.scores[i])
        allK.push(d.kpss[i])
      }
    }
    const order = allS.map((_, i) => i).sort((a, b) => allS[b] - allS[a])
    const keep: number[] = []
    for (let i = 0; i < order.length; i++) {
      const idx = order[i]
      let dup = false
      for (const k of keep) {
        const a = allB[k]
        const b = allB[idx]
        const ix1 = Math.max(a[0], b[0])
        const iy1 = Math.max(a[1], b[1])
        const ix2 = Math.min(a[2], b[2])
        const iy2 = Math.min(a[3], b[3])
        const iw = Math.max(0, ix2 - ix1)
        const ih = Math.max(0, iy2 - iy1)
        const inter = iw * ih
        const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
        const iou = union > 0 ? inter / union : 0
        if (iou > this.nmsIou) { dup = true; break }
      }
      if (!dup) keep.push(idx)
    }
    const out: RawDet = { bboxes: [], scores: [], kpss: [] }
    for (const k of keep) {
      out.bboxes.push(allB[k])
      out.scores.push(allS[k])
      out.kpss.push(allK[k])
    }
    return out
  }

  /** Embed an aligned face from a detection (warp by kps, ArcFace, L2). */
  private async embedFace(img: RgbImage, _bbox: [number, number, number, number], kps: number[][]): Promise<Float32Array> {
    const M = umeyama(kps, ARCFACE_DST)
    const aimg = warpAffine(img, M, this.config.arcInputSize)
    const feat = await this.embedder.getFeat(aimg)
    return this.embedder.l2Normalize(feat)
  }

  /**
   * eDifFIQA aligned-crop quality score for a detection (0..1, higher better).
   * Aligns with the same warp as embedFace — the exact input the model was
   * trained on. Returns null when the gate is disabled.
   */
  private async qualityScoreOf(img: RgbImage, kps: number[][]): Promise<number | null> {
    if (!this.qualityScoreMin) return null
    if (!this.qualityScorer) {
      this.qualityScorer = await QualityScorer.create('', this.backend, this.models.qualityModel, this.config.arcInputSize)
    }
    const M = umeyama(kps, ARCFACE_DST)
    const aimg = warpAffine(img, M, this.config.arcInputSize)
    return this.qualityScorer.scoreAligned(aimg)
  }

  async detectFromImage(img: RgbImage): Promise<DetectedFace[]> {
    const t0 = Date.now()

    // ---- Pass 1: full-image detect at detSize (640) ----
    const pass1 = await this.runDetector(img, this.detSize, this.fullDetThresh)
    const t1 = Date.now()

    // ---- Pass 2/3: adaptive tiles over the whole image ----
    let tiled2: RawDet = { bboxes: [], scores: [], kpss: [] }
    let tiled3: RawDet = { bboxes: [], scores: [], kpss: [] }
    let tileRuns = 0
    if (this.planTiling(img, pass1) === 2) {
      tiled2 = await this.detectTiled(img, 2, this.tileDetThresh)
      tileRuns += 4
    }
    const t2 = Date.now()
    const merged12 = this.nmsAll([pass1, tiled2])
    if (this.shouldRefine(merged12)) {
      tiled3 = await this.detectTiled(img, 3, this.tileDetThresh)
      tileRuns += 9
    }
    const t3 = Date.now()

    // ---- Merge + cross-source NMS ----
    const merged = this.nmsAll([pass1, tiled2, tiled3])

    if (this.debugLog) {
      const fmt = (d: RawDet) => d.bboxes.map((b, i) => `[${b.map((v) => Math.round(v)).join(',')} s=${d.scores[i].toFixed(2)} w=${Math.round(b[2] - b[0])}]`).join(' ')
      console.log(`[detect] pass1(${pass1.bboxes.length}): ${fmt(pass1)}`)
      console.log(`[detect] tiles(${tiled2.bboxes.length}+${tiled3.bboxes.length}): ${fmt(tiled2)}${tiled3.bboxes.length ? ' ' + fmt(tiled3) : ''}`)
      console.log(`[detect] afterNMS(${merged.bboxes.length}): ${fmt(merged)}`)
      // Show which kept faces suppressed near-duplicate candidates (dup evidence).
      for (let k = 0; k < merged.bboxes.length; k++) {
        const kb = merged.bboxes[k]
        const dups = [...pass1.bboxes, ...tiled2.bboxes, ...tiled3.bboxes]
          .map((b, i) => ({ b, src: i < pass1.bboxes.length ? 'p1' : i < pass1.bboxes.length + tiled2.bboxes.length ? 't2' : 't3' }))
          .filter(({ b }) => {
            const ix1 = Math.max(kb[0], b[0]); const iy1 = Math.max(kb[1], b[1])
            const ix2 = Math.min(kb[2], b[2]); const iy2 = Math.min(kb[3], b[3])
            const iw = Math.max(0, ix2 - ix1); const ih = Math.max(0, iy2 - iy1)
            const inter = iw * ih
            const union = (kb[2] - kb[0]) * (kb[3] - kb[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
            return union > 0 && inter / union > this.nmsIou
          })
        if (dups.length > 1) {
          console.log(`[detect] keep #${k} ${kb.map((v) => Math.round(v)).join(',')} suppressed ${dups.length - 1}: ${dups.map((d) => `${d.src}[${d.b.map((v) => Math.round(v)).join(',')}]`).join(' ')}`)
        }
      }
    }

    // ---- Quality gate before recognition ----
    // Stage 1: hard rejections — tiny (< minFacePx), weak score, or
    // geometrically impossible landmarks. These are NOT faces we want in UI.
    let rejectedTiny = 0
    let rejectedScore = 0
    let rejectedKps = 0
    const accepted: Array<{ bbox: [number, number, number, number]; score: number; kps: number[][]; posePenalty: number; fpPenalty: number }> = []
    for (let i = 0; i < merged.bboxes.length; i++) {
      const bbox = merged.bboxes[i] as [number, number, number, number]
      const score = merged.scores[i]
      const kps = merged.kpss[i]
      const gate = this.gateReason(bbox, score, kps)
      if (gate.reason === 'tiny') { rejectedTiny++; continue }
      if (gate.reason === 'score') { rejectedScore++; continue }
      if (gate.reason === 'kps') { rejectedKps++; continue }
      accepted.push({ bbox, score, kps, posePenalty: gate.posePenalty, fpPenalty: gate.fpPenalty })
    }
    const t3b = Date.now()

    // Stage 2: quality classification + conditional embedding.
    // Every accepted detection gets a quality tier; faces below the embedding
    // threshold (very_low) keep embedding null (skipped) unless embedLow is on.
    // An eDifFIQA score below qualityScoreMin additionally downgrades the face
    // to very_low — it stays a valid detection in the UI but can't drive
    // recognition/clustering (protects against phantom clusters from blur /
    // non-face crops).
    const faces: DetectedFace[] = []
    const qTiers = { high: 0, medium: 0, low: 0, very_low: 0 }
    let qualityDowngraded = 0
    for (const f of accepted) {
      const geom = FaceAnalysis.faceGeometry(f.bbox, f.kps)
      const facePose: FacePose = {
        yawRatio: geom.yawRatio,
        eyeDistRatio: geom.eyeDistRatio,
      }
      let { quality } = this.classifyQuality(f.bbox, f.score, f.kps, null)
      let eqScore: number | null = null
      if (this.qualityScoreMin) {
        eqScore = await this.qualityScoreOf(img, f.kps)
        quality = this.classifyQuality(f.bbox, f.score, f.kps, eqScore).quality
        const side = Math.max(f.bbox[2] - f.bbox[0], f.bbox[3] - f.bbox[1])
        // Composite gate: low-confidence detections with poor eDifFIQA are
        // almost always non-face. We lowered the det-score arm to 0.5 (was
        // 0.7) so mid-confidence false positives like back-of-head / shoulder
        // crops (det ~0.5-0.6) also get caught, while real faces at det 0.7+
        // are untouched. Plus a tiny-face blur arm.
        const gateLowDet = f.score < this.qualityGateDetScore && eqScore !== null && eqScore < this.qualityGateEqScore
        const gateTiny = side < this.qualityGateTinySidePx && eqScore !== null && eqScore < this.qualityGateEqTiny
        if (gateLowDet || gateTiny) {
          quality = 'very_low'
          qualityDowngraded += 1
        }
      }
      // Pose/FP penalties applied AFTER eDifFIQA so the eDifFIQA re-classify
      // does not overwrite them (back-of-head/shoulder crops stay downgraded).
      if (f.posePenalty > 0) {
        const order: FaceQuality[] = ['high', 'medium', 'low', 'very_low']
        quality = order[Math.min(order.length - 1, Math.max(0, order.indexOf(quality) + f.posePenalty))]
      }
      if (f.fpPenalty > 0) {
        const order: FaceQuality[] = ['high', 'medium', 'low', 'very_low']
        quality = order[Math.min(order.length - 1, Math.max(0, order.indexOf(quality) + f.fpPenalty))]
      }
      qTiers[quality] += 1
      const shouldEmbed = this.embed && (quality !== 'very_low' || this.embedLow)
      faces.push({
        bbox: f.bbox,
        detScore: f.score,
        kps: f.kps,
        embedding: shouldEmbed ? await this.embedFace(img, f.bbox, f.kps) : null,
        quality,
        facePose,
        // When the gate is on, qualityScore = eDifFIQA score (0..1); otherwise
        // the geometric heuristic (kept for backward compat with tools/UI).
        qualityScore: this.qualityScoreMin ? (eqScore ?? 0) : this.classifyQuality(f.bbox, f.score, f.kps).qualityScore,
        lowQuality: quality === 'very_low',
      })
    }
    const t4 = Date.now()

    if (this.debugLog) {
      console.log(`[detect] quality tiers: high=${qTiers.high} medium=${qTiers.medium} low=${qTiers.low} very_low=${qTiers.very_low}  embedded=${faces.filter((f) => f.embedding).length}  eDifFIQA-downgraded=${qualityDowngraded}`)
    }

    this.lastTimings = {
      fullImageMs: t1 - t0,
      tileMs: (t2 - t1) + (t3 - t2),
      embedMs: t4 - t3b,
      tileRuns,
    }
    this.lastBreakdown = {
      rawFull: pass1.bboxes.length,
      rawTile: tiled2.bboxes.length + tiled3.bboxes.length,
      afterNms: merged.bboxes.length,
      afterGate: faces.length,
      final: faces.length,
      rejectedTiny,
      rejectedScore,
      rejectedKps,
      qualityDowngraded,
    }
    return faces
  }
}
