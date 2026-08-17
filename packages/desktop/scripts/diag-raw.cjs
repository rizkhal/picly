/**
 * Debug: check the raw buffer from decodeRgb — are pixels non-zero?
 * Usage: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/diag-raw.cjs <photo>
 */
const { decodeRgb } = require('../dist-main/ml/image.js')

async function main() {
  const photo = process.argv[2]
  const img = await decodeRgb(photo)
  const { width, height, data } = img
  console.log(`size: ${width}x${height} buffer: ${data.length} (expect ${width * height * 3})`)
  const sample = [0, 1, 2, width * 3, (height >> 1) * width * 3, data.length - 3]
  for (const idx of sample) {
    console.log(`  pixel@${idx}: ${data[idx]},${data[idx + 1]},${data[idx + 2]}`)
  }
  let sum = 0
  for (let i = 0; i < Math.min(data.length, 100000); i++) sum += data[i]
  console.log(`mean of first 100k bytes: ${(sum / 100000).toFixed(2)}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
