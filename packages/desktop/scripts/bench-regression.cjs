#!/usr/bin/env node
/**
 * Regression: scan the full psdkp-sample-tile with the new pipeline and report
 * per-tier detections + clusters/singletons, to make sure the FP/pose penalties
 * didn't drop real faces or break clustering.
 *
 * Does NOT write to the app DB — it uses an in-memory temp store.
 *
 * Usage:
 *   cd desktop && node scripts/prepare-native.mjs electron && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/bench-regression.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { FaceAnalysis } = require('../dist-main/ml/faceAnalysis.js')
const { decodeRgb } = require('../dist-main/ml/image.js')

const MODELS_DIR = process.env.PICLY_MODELS_DIR || path.join(__dirname, '..', 'models')
process.env.PICLY_MODELS_DIR = MODELS_DIR

const DIR = '/Volumes/X/Dataset/psdkp-sample-tile'

async function main() {
  const analysis = await FaceAnalysis.create({ embed: true })
  const files = fs.readdirSync(DIR).filter((f) => /\.JPG$/i.test(f) && !f.startsWith('._')).sort()
  const tiers = { high: 0, medium: 0, low: 0, very_low: 0 }
  const embedded = { high: 0, medium: 0, low: 0, very_low: 0 }
  const sizeBuckets = { '>100': 0, '64-100': 0, '32-64': 0, '20-32': 0, '<20': 0 }
  let total = 0
  let photos = 0
  const embeddings = []
  const sims = []
  let t0 = Date.now()

  for (const fn of files) {
    const img = await decodeRgb(path.join(DIR, fn))
    const dets = await analysis.detectFromImage(img)
    photos++
    for (const d of dets) {
      total++
      tiers[d.quality]++
      const side = Math.max(d.bbox[2] - d.bbox[0], d.bbox[3] - d.bbox[1])
      if (side > 100) sizeBuckets['>100']++
      else if (side >= 64) sizeBuckets['64-100']++
      else if (side >= 32) sizeBuckets['32-64']++
      else if (side >= 20) sizeBuckets['20-32']++
      else sizeBuckets['<20']++
      if (d.embedding) {
        embedded[d.quality]++
        embeddings.push(d.embedding)
      }
    }
  }

  // within-photo sims for false-merge risk (sample first N pairs)
  let pairCount = 0
  for (const fn of files) {
    if (pairCount >= 300) break
    const img = await decodeRgb(path.join(DIR, fn))
    const dets = await analysis.detectFromImage(img).catch(() => [])
    for (let i = 0; i < dets.length && pairCount < 300; i++) {
      for (let j = i + 1; j < dets.length && pairCount < 300; j++) {
        if (!dets[i].embedding || !dets[j].embedding) continue
        let s = 0
        for (let k = 0; k < dets[i].embedding.length; k++) s += dets[i].embedding[k] * dets[j].embedding[k]
        sims.push(s)
        pairCount++
      }
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`photos=${photos} total_detections=${total}`)
  console.log(`tiers: high=${tiers.high} medium=${tiers.medium} low=${tiers.low} very_low=${tiers.very_low}`)
  console.log(`embedded: high=${embedded.high} medium=${embedded.medium} low=${embedded.low} very_low=${embedded.very_low}`)
  console.log(`sizeBuckets: ${JSON.stringify(sizeBuckets)}`)
  sims.sort((a, b) => a - b)
  const pct = (p) => sims[Math.min(sims.length - 1, Math.floor((p / 100) * sims.length))].toFixed(3)
  console.log(`within-photo sims n=${sims.length}: p50=${pct(50)} p90=${pct(90)} p95=${pct(95)} p99=${pct(99)} max=${pct(100)}`)
  console.log(`elapsed=${elapsed}s`)
}

main().catch((e) => { console.error(e); process.exit(1) })
