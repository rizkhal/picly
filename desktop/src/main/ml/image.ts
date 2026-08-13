import sharp from 'sharp'
import type { RgbImage } from './types'

/**
 * Decode an image file to raw RGB at full resolution.
 * NOTE: sharp does not apply EXIF orientation by default, which matches
 * cv2.imread (the Python reference ignores orientation too).
 */
export async function decodeRgb(filePath: string): Promise<RgbImage> {
  const { data, info } = await sharp(filePath, { failOn: 'none' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data }
}

/**
 * Decode directly to a max dimension, then letterbox to `target` x `target`.
 * Returns the final detection-ready image plus the scale factor needed to map
 * coordinates back to the original resolution. This avoids loading a full
 * 72 MB raw buffer for large photos.
 */
export async function decodeRgbLetterboxed(
  filePath: string,
  target: number,
): Promise<{ image: RgbImage; detScale: number }> {
  const meta = await sharp(filePath, { failOn: 'none' }).metadata()
  const origW = meta.width ?? 0
  const origH = meta.height ?? 0
  if (origW === 0 || origH === 0) {
    // Fallback: full decode then letterbox
    const img = await decodeRgb(filePath)
    const { resized, detScale } = letterbox(img, target)
    return { image: resized, detScale }
  }
  const imRatio = origH / origW
  const modelRatio = 1
  let newW: number
  let newH: number
  if (imRatio > modelRatio) {
    newH = target
    newW = Math.floor(target / imRatio)
  } else {
    newW = target
    newH = Math.floor(target * imRatio)
  }
  const detScale = newH / origH
  const resized = await resizeBilinearFromSharp(filePath, newW, newH)
  const padded = new Uint8Array(target * target * 3)
  for (let y = 0; y < newH; y++) {
    padded.set(resized.data.subarray(y * newW * 3, (y + 1) * newW * 3), y * target * 3)
  }
  return { image: { width: target, height: target, data: padded }, detScale }
}

/** Resize using sharp, then return raw RGB. Avoids loading full-res into memory. */
async function resizeBilinearFromSharp(filePath: string, dstW: number, dstH: number): Promise<RgbImage> {
  const { data, info } = await sharp(filePath, { failOn: 'none' })
    .resize(dstW, dstH, { fit: 'cover', position: 'centre' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data }
}

/**
 * cv2.resize(INTER_LINEAR) equivalent: bilinear with border-replicate.
 * Uses OpenCV's coordinate mapping sx = (dx + 0.5) * (srcW / dstW) - 0.5.
 */
export function resizeBilinear(src: RgbImage, dstW: number, dstH: number): RgbImage {
  const sw = src.width
  const sh = src.height
  const sdata = src.data
  const out = new Uint8Array(dstW * dstH * 3)
  const fx = sw / dstW
  const fy = sh / dstH
  for (let dy = 0; dy < dstH; dy++) {
    let sy = (dy + 0.5) * fy - 0.5
    if (sy < 0) sy = 0
    if (sy > sh - 1) sy = sh - 1
    const y0 = Math.floor(sy)
    const y1 = y0 + 1 < sh ? y0 + 1 : y0
    const wy = sy - y0
    for (let dx = 0; dx < dstW; dx++) {
      let sx = (dx + 0.5) * fx - 0.5
      if (sx < 0) sx = 0
      if (sx > sw - 1) sx = sw - 1
      const x0 = Math.floor(sx)
      const x1 = x0 + 1 < sw ? x0 + 1 : x0
      const wx = sx - x0
      const o = (dy * dstW + dx) * 3
      for (let c = 0; c < 3; c++) {
        const base = c
        const p00 = sdata[(y0 * sw + x0) * 3 + base]
        const p10 = sdata[(y0 * sw + x1) * 3 + base]
        const p01 = sdata[(y1 * sw + x0) * 3 + base]
        const p11 = sdata[(y1 * sw + x1) * 3 + base]
        const top = p00 + (p10 - p00) * wx
        const bottom = p01 + (p11 - p01) * wx
        out[o + c] = Math.round(top + (bottom - top) * wy)
      }
    }
  }
  return { width: dstW, height: dstH, data: out }
}

/**
 * SCRFD letterbox: resize keeping aspect ratio to fit `target`, then zero-pad
 * on the right/bottom to target x target (exact port of insightface SCRFD.detect).
 * Returns the padded image plus det_scale (new_h / original_h).
 */
export function letterbox(img: RgbImage, target: number): { resized: RgbImage; detScale: number } {
  const w = img.width
  const h = img.height
  const imRatio = h / w
  const modelRatio = 1 // input_size is square
  let newW: number
  let newH: number
  if (imRatio > modelRatio) {
    newH = target
    newW = Math.floor(target / imRatio)
  } else {
    newW = target
    newH = Math.floor(target * imRatio)
  }
  const detScale = newH / h
  const resized = resizeBilinear(img, newW, newH)
  const padded = new Uint8Array(target * target * 3)
  for (let y = 0; y < newH; y++) {
    padded.set(resized.data.subarray(y * newW * 3, (y + 1) * newW * 3), y * target * 3)
  }
  return { resized: { width: target, height: target, data: padded }, detScale }
}

/**
 * cv2.dnn.blobFromImage equivalent: RGB (or BGR, already converted by caller)
 * to NCHW float32 with (pixel - mean) * invStd, in-place into a single
 * Float32Array laid out channel-first.
 */
export function toNchwBlob(img: RgbImage, mean: number, invStd: number): Float32Array {
  const { data, width, height } = img
  const hw = width * height
  const out = new Float32Array(3 * hw)
  for (let i = 0, p = 0; i < data.length; i += 3, p++) {
    out[p] = (data[i] - mean) * invStd
    out[p + hw] = (data[i + 1] - mean) * invStd
    out[p + 2 * hw] = (data[i + 2] - mean) * invStd
  }
  return out
}

/**
 * Crop an axis-aligned box from a raw image and upscale it with bilinear
 * interpolation (border-replicate) to `size` x `size`. Used by the two-pass
 * detector to re-detect small faces: the crop is upscaled so SCRFD sees the
 * face at a larger scale, then boxes/landmarks are mapped back to original
 * coordinates via the crop offset + scale.
 */
export function cropFace(src: RgbImage, box: [number, number, number, number], size: number): RgbImage {
  const [x1, y1, x2, y2] = box
  const sw = src.width
  const sh = src.height
  const sdata = src.data
  const bw = Math.max(1, x2 - x1)
  const bh = Math.max(1, y2 - y1)
  const out = new Uint8Array(size * size * 3)
  // Inverse map: dst (i,j) samples src (x1 + j * bw/size, y1 + i * bh/size)
  for (let i = 0; i < size; i++) {
    const sy = y1 + ((i + 0.5) * bh) / size - 0.5
    const y0 = Math.max(0, Math.floor(sy))
    const y1b = Math.min(sh - 1, y0 + 1)
    const wy = sy - y0
    for (let j = 0; j < size; j++) {
      const sx = x1 + ((j + 0.5) * bw) / size - 0.5
      const x0 = Math.max(0, Math.floor(sx))
      const x1b = Math.min(sw - 1, x0 + 1)
      const wx = sx - x0
      const o = (i * size + j) * 3
      for (let c = 0; c < 3; c++) {
        const p00 = sdata[(y0 * sw + x0) * 3 + c]
        const p10 = sdata[(y0 * sw + x1b) * 3 + c]
        const p01 = sdata[(y1b * sw + x0) * 3 + c]
        const p11 = sdata[(y1b * sw + x1b) * 3 + c]
        const top = p00 + (p10 - p00) * wx
        const bottom = p01 + (p11 - p01) * wx
        out[o + c] = Math.round(top + (bottom - top) * wy)
      }
    }
  }
  return { width: size, height: size, data: out }
}

/**
 * Crop an axis-aligned region from a raw image WITHOUT resizing (returns a
 * sub-image). Used by the tiled detector to feed each tile through letterbox.
 */
export function cropRegion(src: RgbImage, box: [number, number, number, number]): RgbImage {
  const x1 = Math.max(0, Math.floor(box[0]))
  const y1 = Math.max(0, Math.floor(box[1]))
  const x2 = Math.min(src.width, Math.ceil(box[2]))
  const y2 = Math.min(src.height, Math.ceil(box[3]))
  const w = Math.max(1, x2 - x1)
  const h = Math.max(1, y2 - y1)
  const out = new Uint8Array(w * h * 3)
  const sdata = src.data
  const sw = src.width
  for (let y = 0; y < h; y++) {
    const s = ((y1 + y) * sw + x1) * 3
    out.set(sdata.subarray(s, s + w * 3), y * w * 3)
  }
  return { width: w, height: h, data: out }
}

/**
 * cv2.warpAffine equivalent for uint8 images (INTER_LINEAR, borderValue=0).
 * M is the 2x3 forward (src -> dst) affine; each destination pixel samples the
 * source at M^-1 * (x, y, 1) — the inverse-mapping convention of OpenCV.
 */
export function warpAffine(src: RgbImage, m: number[][], size: number, borderValue = 0): RgbImage {
  const sw = src.width
  const sh = src.height
  const sdata = src.data
  const det = m[0][0] * m[1][1] - m[0][1] * m[1][0]
  const inv = [
    [m[1][1] / det, -m[0][1] / det, (m[0][1] * m[1][2] - m[1][1] * m[0][2]) / det],
    [-m[1][0] / det, m[0][0] / det, (m[1][0] * m[0][2] - m[0][0] * m[1][2]) / det],
  ]
  const out = new Uint8Array(size * size * 3)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = inv[0][0] * x + inv[0][1] * y + inv[0][2]
      const sy = inv[1][0] * x + inv[1][1] * y + inv[1][2]
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const wx = sx - x0
      const wy = sy - y0
      const x1 = x0 + 1
      const y1 = y0 + 1
      const o = (y * size + x) * 3
      for (let c = 0; c < 3; c++) {
        // Taps outside the source are treated as borderValue.
        let v = 0
        v += (x0 >= 0 && x0 < sw && y0 >= 0 && y0 < sh ? sdata[(y0 * sw + x0) * 3 + c] : borderValue) * (1 - wx) * (1 - wy)
        v += (x1 >= 0 && x1 < sw && y0 >= 0 && y0 < sh ? sdata[(y0 * sw + x1) * 3 + c] : borderValue) * wx * (1 - wy)
        v += (x0 >= 0 && x0 < sw && y1 >= 0 && y1 < sh ? sdata[(y1 * sw + x0) * 3 + c] : borderValue) * (1 - wx) * wy
        v += (x1 >= 0 && x1 < sw && y1 >= 0 && y1 < sh ? sdata[(y1 * sw + x1) * 3 + c] : borderValue) * wx * wy
        out[o + c] = Math.round(v)
      }
    }
  }
  return { width: size, height: size, data: out }
}
