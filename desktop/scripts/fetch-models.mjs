#!/usr/bin/env node
/**
 * Fetch the ONNX models Picly ships inside the packaged app.
 *
 * The full InsightFace buffalo_l pack is ~190 MB; Picly only loads two graphs:
 *   - det_10g.onnx   SCRFD face detection   (~17 MB)
 *   - w600k_r50.onnx ArcFace recognition    (~174 MB)
 *
 * This script downloads the official pack from GitHub releases, extracts only
 * those two files, and writes them to desktop/models/buffalo_l/ — the folder
 * electron-builder copies into the app via extraResources
 * (Contents/Resources/models). The models are never committed to git.
 *
 * Idempotent: skips the download when both files already exist (non-empty).
 * Invoked automatically by "npm run electron:build" (and by CI before it).
 *
 * Usage: node scripts/fetch-models.mjs
 */
import { execFileSync } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const MODELS_URL = 'https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip'
const NEEDED = ['det_10g.onnx', 'w600k_r50.onnx']

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'models', 'buffalo_l')

function log(msg) {
  console.log(`[fetch-models] ${msg}`)
}

async function alreadyPresent() {
  for (const name of NEEDED) {
    try {
      const s = await stat(path.join(OUT_DIR, name))
      if (!s.size) return false
    } catch {
      return false
    }
  }
  return true
}

async function downloadZip(dest) {
  log(`downloading ${MODELS_URL}`)
  const res = await fetch(MODELS_URL, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  const total = Number(res.headers.get('content-length') || 0)
  let received = 0
  let lastPct = -1
  const body = Readable.fromWeb(res.body)
  body.on('data', (chunk) => {
    received += chunk.length
    if (total) {
      const pct = Math.floor((received / total) * 100)
      if (pct >= lastPct + 10) {
        lastPct = pct
        log(`${pct}% (${(received / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB)`)
      }
    }
  })
  await pipeline(body, createWriteStream(dest))
  log(`downloaded ${(received / 1e6).toFixed(0)} MB`)
}

async function extractNeeded(zipPath) {
  const tmp = await mkdtemp(path.join(tmpdir(), 'buffalo_l-'))
  try {
    log(`extracting to ${tmp}`)
    execFileSync('unzip', ['-o', '-q', zipPath, '-d', tmp], { stdio: 'inherit' })
    // Locate the files inside the tree — zip layouts differ (buffalo_l/ vs flat).
    const found = {}
    const entries = await readdir(tmp, { recursive: true })
    for (const rel of entries) {
      const base = path.basename(rel)
      if (NEEDED.includes(base)) found[base] = path.join(tmp, rel)
    }
    for (const name of NEEDED) {
      if (!found[name]) throw new Error(`model "${name}" not found inside ${zipPath}`)
    }
    await mkdir(OUT_DIR, { recursive: true })
    for (const name of NEEDED) {
      await copyFile(found[name], path.join(OUT_DIR, name))
      const s = await stat(path.join(OUT_DIR, name))
      log(`${name} -> ${(s.size / 1e6).toFixed(0)} MB`)
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  if (await alreadyPresent()) {
    log('models already present, skipping download')
    return
  }
  const zipPath = path.join(tmpdir(), `buffalo_l-${process.pid}.zip`)
  try {
    await downloadZip(zipPath)
    await extractNeeded(zipPath)
    log(`done -> ${OUT_DIR}`)
  } finally {
    await rm(zipPath, { force: true })
  }
}

main().catch((err) => {
  console.error(`[fetch-models] failed: ${err.message}`)
  process.exit(1)
})
