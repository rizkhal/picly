/**
 * Desktop image helpers — re-exported from the shared `picly-ml` package.
 * `decodeRgb` stays here (desktop-only, uses sharp); the pure geometry helpers
 * (resize/letterbox/blob/crop/warp) are shared with mobile.
 */
import sharp from 'sharp'
import { resizeBilinear, letterbox, toNchwBlob, warpAffine, cropFace, cropRegion } from 'picly-ml'
import type { RgbImage } from 'picly-ml'

export { resizeBilinear, letterbox, toNchwBlob, warpAffine, cropFace, cropRegion }
export type { RgbImage } from 'picly-ml'

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
