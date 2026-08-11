/**
 * Small linear-algebra helpers for the ML pipeline.
 *
 * `umeyama` is a faithful port of skimage.transform._geometric._umeyama
 * (called by `SimilarityTransform.estimate` in insightface's face_align.py),
 * i.e. the exact algorithm behind `estimate_norm`. Inputs are 5x2 landmark
 * arrays; output is the 2x3 affine similarity matrix M.
 */

export type Mat2 = number[][]

const EPS = 1e-12

export function det2(m: number[][]): number {
  return m[0][0] * m[1][1] - m[0][1] * m[1][0]
}

function matMul(a: number[][], b: number[][]): number[][] {
  const rows = a.length
  const mid = b.length
  const cols = b[0].length
  const out: number[][] = []
  for (let i = 0; i < rows; i++) {
    const row: number[] = new Array(cols).fill(0)
    for (let k = 0; k < mid; k++) {
      const aik = a[i][k]
      if (aik === 0) continue
      const bk = b[k]
      for (let j = 0; j < cols; j++) row[j] += aik * bk[j]
    }
    out.push(row)
  }
  return out
}

/**
 * SVD of a real 2x2 matrix A = U diag(S) Vt.
 * Returns [U, S, Vt] with U/Vt orthonormal (U columns / Vt rows are the
 * singular vectors) and S sorted descending.
 *
 * Sign convention is self-consistent: u_i = A v_i / s_i, so products like
 * U Vt are invariant to the arbitrary eigenvector signs. For face landmarks
 * A is full rank, so the rank-1/rank-0 branches in umeyama never trigger.
 */
export function svd2(A: Mat2): [Mat2, [number, number], Mat2] {
  const a = A[0][0]
  const b = A[0][1]
  const c = A[1][0]
  const d = A[1][1]

  // AtA = A^T A is symmetric 2x2: [[p, q], [q, r]]
  const p = a * a + c * c
  const q = a * b + c * d
  const r = b * b + d * d
  const trace = p + r
  const det = p * r - q * q
  const disc = Math.sqrt(Math.max(0, trace * trace - 4 * det))
  const l1 = (trace + disc) / 2
  const l2 = (trace - disc) / 2
  const s1 = Math.sqrt(Math.max(0, l1))
  const s2 = Math.sqrt(Math.max(0, l2))

  // Eigenvector of AtA for l1: v = (q, l1 - p)
  let v1x: number
  let v1y: number
  if (Math.abs(q) > EPS || Math.abs(l1 - p) > EPS) {
    v1x = q
    v1y = l1 - p
  } else {
    v1x = 1
    v1y = 0
  }
  const n1 = Math.hypot(v1x, v1y)
  v1x /= n1
  v1y /= n1
  const v2x = -v1y
  const v2y = v1x

  let u1x = 0
  let u1y = 0
  if (s1 > EPS) {
    u1x = (a * v1x + b * v1y) / s1
    u1y = (c * v1x + d * v1y) / s1
    const nu = Math.hypot(u1x, u1y)
    if (nu > EPS) {
      u1x /= nu
      u1y /= nu
    }
  }
  let u2x = -u1y
  let u2y = u1x
  if (s2 > EPS) {
    const m12 = a * v2x + b * v2y
    const m22 = c * v2x + d * v2y
    u2x = m12 / s2
    u2y = m22 / s2
    const nu = Math.hypot(u2x, u2y)
    if (nu > EPS) {
      u2x /= nu
      u2y /= nu
    }
  }

  const U: Mat2 = [
    [u1x, u2x],
    [u1y, u2y],
  ]
  const Vt: Mat2 = [
    [v1x, v1y],
    [v2x, v2y],
  ]
  return [U, [s1, s2], Vt]
}

/**
 * Port of skimage _umeyama(src, dst, estimate_scale=True) — the similarity
 * transform fitting used by insightface's estimate_norm. Returns the 2x3
 * affine matrix M (src -> dst).
 */
export function umeyama(src: number[][], dst: number[][]): number[][] {
  const n = src.length
  const dim = 2

  const srcMean = [0, 0]
  const dstMean = [0, 0]
  for (let i = 0; i < n; i++) {
    srcMean[0] += src[i][0]
    srcMean[1] += src[i][1]
    dstMean[0] += dst[i][0]
    dstMean[1] += dst[i][1]
  }
  srcMean[0] /= n
  srcMean[1] /= n
  dstMean[0] /= n
  dstMean[1] /= n

  const srcDemean: number[][] = []
  let srcVarSum = 0 // population variance of src, summed over dims
  for (let i = 0; i < n; i++) {
    const sx = src[i][0] - srcMean[0]
    const sy = src[i][1] - srcMean[1]
    srcDemean.push([sx, sy])
    srcVarSum += (sx * sx + sy * sy) / n
  }

  // A = dst_demean.T @ src_demean / n   (2x2)
  const A: Mat2 = [
    [0, 0],
    [0, 0],
  ]
  for (let i = 0; i < n; i++) {
    const dx = dst[i][0] - dstMean[0]
    const dy = dst[i][1] - dstMean[1]
    const sx = srcDemean[i][0]
    const sy = srcDemean[i][1]
    A[0][0] += (dx * sx) / n
    A[0][1] += (dx * sy) / n
    A[1][0] += (dy * sx) / n
    A[1][1] += (dy * sy) / n
  }

  const d = [1, 1]
  if (det2(A) < 0) d[1] = -1

  const [U, S, Vt] = svd2(A)
  const rank = (S[0] > EPS ? 1 : 0) + (S[1] > EPS ? 1 : 0)

  let R: Mat2
  if (rank === 0) {
    return [
      [NaN, NaN, NaN],
      [NaN, NaN, NaN],
    ]
  } else if (rank === dim - 1) {
    if (det2(U) * det2(Vt) > 0) {
      R = matMul(U, Vt)
    } else {
      R = matMul(matMul(U, [[1, 0], [0, -1]]), Vt)
    }
  } else {
    R = matMul(matMul(U, [[d[0], 0], [0, d[1]]]), Vt)
  }

  // estimate_scale = true (SimilarityTransform): scale = (S @ d) / var_sum
  let scale = 0
  if (srcVarSum > EPS) {
    scale = (S[0] * d[0] + S[1] * d[1]) / srcVarSum
  }

  const M: number[][] = [
    [R[0][0] * scale, R[0][1] * scale, 0],
    [R[1][0] * scale, R[1][1] * scale, 0],
  ]
  M[0][2] = dstMean[0] - (M[0][0] * srcMean[0] + M[0][1] * srcMean[1])
  M[1][2] = dstMean[1] - (M[1][0] * srcMean[0] + M[1][1] * srcMean[1])
  return M
}
