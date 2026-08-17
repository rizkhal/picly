// Generate the app icon set from assets/aperture-icon.svg:
//   - build/icon.png        (512px, electron-builder linux/win fallback)
//   - build/icon.icns       (macOS, built with iconutil)
//   - build/icon.ico        (Windows, built with sips/iconutil)
//   - build/icons/          (PNG sizes for electron-builder)
//
// Run: node scripts/generate-icon.mjs
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const root = path.resolve(__dirname, '..')
const svg = path.join(root, '..', 'assets', 'aperture-icon.svg')
const buildDir = path.join(root, 'build')
const iconsDir = path.join(buildDir, 'icons')

// Sizes electron-builder wants (mac + win + linux)
const PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]

// icns requires a specific set of sizes (iconutil validates these)
const ICNS_SIZES = [16, 32, 64, 128, 256, 512, 1024]

// Render SVG -> PNG at a given size using sharp (librsvg backend handles SVG well)
function renderPng(size, out) {
  const sharp = require('sharp')
  return sharp(svg).resize(size, size).png().toFile(out)
}

rmSync(buildDir, { recursive: true, force: true })
mkdirSync(iconsDir, { recursive: true })

// 1. Render all PNG sizes
const pngs = {}
for (const size of PNG_SIZES) {
  const out = path.join(iconsDir, `${size}x${size}.png`)
  pngs[size] = out
}
// Render base sizes (iconutil wants @1x/@2x naming; we render 1x and 2x)
for (const size of [...new Set([...PNG_SIZES, ...ICNS_SIZES])]) {
  const out = path.join(iconsDir, `icon_${size}x${size}.png`)
  pngs[size] = out
}

// 2. icon.icns via iconutil (macOS native tool)
const icnsDir = path.join(buildDir, 'icon.iconset')
mkdirSync(icnsDir, { recursive: true })
await Promise.all(
  ICNS_SIZES.flatMap((size) => {
    const jobs = []
    // icon_16x16.png, icon_16x16@2x.png (32), icon_32x32.png, etc.
    if (size === 16 || size === 32 || size === 128 || size === 256 || size === 512) {
      jobs.push(
        renderPng(size, path.join(icnsDir, `icon_${size}x${size}.png`)),
        renderPng(size * 2, path.join(icnsDir, `icon_${size}x${size}@2x.png`)),
      )
    }
    return jobs
  }),
)
execFileSync('iconutil', ['-c', 'icns', icnsDir, '-o', path.join(buildDir, 'icon.icns')], { stdio: 'inherit' })

// 3. icon.ico — sips can convert PNG->ICO
const icoSrc = path.join(iconsDir, 'icon_256x256.png')
await renderPng(256, icoSrc)
try {
  execFileSync('sips', ['-s', 'format', 'ico', icoSrc, '--out', path.join(buildDir, 'icon.ico')], { stdio: 'inherit' })
} catch (e) {
  console.warn('sips ico conversion failed (Windows icon skipped):', e.message)
}

// 4. icon.png — 512x512 fallback for linux/electron-builder
await renderPng(512, path.join(buildDir, 'icon.png'))

// Cleanup iconset
rmSync(icnsDir, { recursive: true, force: true })

console.log('Icon set generated in', buildDir)
