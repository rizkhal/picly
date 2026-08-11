import sharp from 'sharp'

export const THUMB_SIZE = 300

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
