#!/usr/bin/env node
/**
 * Sync the shared monorepo models (root /models — single source of truth used
 * by desktop + mobile) into packages/mobile/assets/ as flat ONNX bundles.
 *
 * Why a copy instead of requiring from root? Metro skips files matched by
 * .gitignore, and the root /models dir is gitignored (~190MB, never committed).
 * So the mobile app bundles from packages/mobile/assets/, which is filled from
 * root by this script. It is a build artifact — re-run after fetching models:
 *
 *   node scripts/sync-models.mjs
 *
 * Idempotent: copies only when the source exists; logs a warning when the root
 * models are missing (dev machine hasn't fetched them yet).
 */
import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MOBILE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = path.resolve(MOBILE_DIR, '..', '..')

const SOURCES = {
  'det_10g.onnx': ['buffalo_l', 'det_10g.onnx'],
  'w600k_r50.onnx': ['buffalo_l', 'w600k_r50.onnx'],
  'ediffiqa_t.onnx': ['ediffiqa', 'ediffiqa_t.onnx'],
}

const OUT = path.join(MOBILE_DIR, 'assets')

async function main() {
  await mkdir(OUT, { recursive: true })
  let missing = []
  for (const [outName, [sub, file]] of Object.entries(SOURCES)) {
    const src = path.join(ROOT, 'models', sub, file)
    try {
      await copyFile(src, path.join(OUT, outName))
      console.log(`[sync-models] ${outName} <- models/${sub}/${file}`)
    } catch {
      missing.push(`models/${sub}/${file}`)
    }
  }
  if (missing.length) {
    console.warn(`[sync-models] WARNING missing from root /models: ${missing.join(', ')}`)
    console.warn('[sync-models] run: cd packages/desktop && npm run fetch:models (or node scripts/fetch-models.mjs)')
    process.exitCode = 1
  }
}

main()
