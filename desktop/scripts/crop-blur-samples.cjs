#!/usr/bin/env node
/** Crop specific bboxes from DSC01523 for blur calibration. */
const path = require('node:path')
const sharp = require('sharp')
const OUT = path.join(__dirname, '..', 'assets', 'debug', 'blur-crops')
const SRC = '/Volumes/X/Dataset/psdkp-sample-tile/DSC01523.JPG'
;(async () => {
  const boxes = [
    ['vol74', [4919, 1771, 4951, 1811]],
    ['vol165', [5192, 1806, 5237, 1863]],
    ['vol328', [4578, 1752, 4626, 1811]],
    ['face1', [4446, 1775, 4525, 1875]],
    ['face2', [4528, 1784, 4578, 1856]],
  ]
  for (const [name, [x1, y1, x2, y2]] of boxes) {
    const pad = Math.round((x2 - x1) * 0.3)
    await sharp(SRC, { limitInputPixels: false })
      .extract({ left: Math.max(0, x1 - pad), top: Math.max(0, y1 - pad), width: x2 - x1 + 2 * pad, height: y2 - y1 + 2 * pad })
      .resize({ width: 300 })
      .jpeg({ quality: 85 })
      .toFile(path.join(OUT, `DSC01523_${name}.jpg`))
    console.log('wrote', name)
  }
})().catch((e) => { console.error(e); process.exit(1) })
