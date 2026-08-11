import sharp from 'sharp'

export const THUMB_SIZE = 300
/** Size of the per-face crop previews shown in the face rail. */
export const FACE_CROP_SIZE = 96

/**
 * Square thumbnail preserving the center crop — port of the backend's
 * ml.make_thumbnail (side = min(w,h), center crop, resize, JPEG q85).
 */
export async function makeThumbnail(srcPath: string, destPath: string, size = THUMB_SIZE): Promise<boolean> {
  try {
    await sharp(srcPath, { failOn: 'none' })
      .resize(size, size, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 85 })
      .toFile(destPath)
    return true
  } catch {
    return false
  }
}

/**
 * Crop a face bounding box from a photo into its own preview file (JPEG q85).
 * Bbox is padded a bit and clamped to the image bounds; used for the face rail
 * and could power face-click-to-open later. Returns false on any failure.
 */
export async function makeFaceCrop(
  srcPath: string,
  destPath: string,
  bbox: [number, number, number, number],
  size = FACE_CROP_SIZE,
): Promise<boolean> {
  try {
    const [x1, y1, x2, y2] = bbox
    const left = Math.max(0, Math.round(x1))
    const top = Math.max(0, Math.round(y1))
    const right = Math.round(x2)
    const bottom = Math.round(y2)
    const w = Math.max(1, right - left)
    const h = Math.max(1, bottom - top)
    const meta = await sharp(srcPath, { failOn: 'none' }).metadata()
    const iw = meta.width ?? 0
    const ih = meta.height ?? 0
    const cw = Math.min(w, Math.max(0, iw - left))
    const ch = Math.min(h, Math.max(0, ih - top))
    // Guard against degenerate crops.
    if (cw < 2 || ch < 2) return false
    await sharp(srcPath, { failOn: 'none' })
      .extract({ left, top, width: cw, height: ch })
      .resize(size, size, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 85 })
      .toFile(destPath)
    return true
  } catch {
    return false
  }
}
