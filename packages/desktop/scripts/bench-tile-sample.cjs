/**
 * Tile-detection benchmark on the psdkp-sample-tile folder (4 photos).
 * Prints: expected/detected/missed faces, size distribution, per-stage
 * inference timing, and the RAW -> NMS -> QUALITY GATE -> FINAL breakdown.
 *
 * Configuration via env vars (controlled experiments, one variable per run):
 *   BENCH_FULL_THRESH  full-image confidence threshold  (default 0.5)
 *   BENCH_TILE_THRESH  tile confidence threshold        (default 0.5)
 *   BENCH_RE_PX        tiny-face trigger size           (default 80)
 *   BENCH_NMS_IOU      cross-source NMS IoU             (default 0.3)
 *   BENCH_MIN_PX       quality-gate min face side px    (default 16)
 *   BENCH_MIN_SCORE    quality-gate min score           (default 0.3)
 *   BENCH_OVERLAP      tile overlap fraction            (default 0.2)
 *   BENCH_NO_EMBED=1   skip ArcFace embedding (detection-only, faster)
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/bench-tile-sample.cjs
 */
const path = require('node:path')
const fs = require('node:fs')

const ROOT = path.join(__dirname, '..')
const DATA = path.join(ROOT, 'data')
const DB = path.join(DATA, 'test-tile-bench.db')
const THUMBS = path.join(DATA, 'test-tile-bench-thumbs')
// Dataset lives in the project root (data/psdkp-sample-tile), NOT in
// /Volumes/X/Dataset — this is the canonical sample set for experiments.
const PHOTOS = path.join(__dirname, '..', '..', 'data', 'psdkp-sample-tile')

// Reuse an existing bench DB instead of wiping it (useful to re-run the
// usefulness proxy or clustering report without re-scanning).
const KEEP_DB = process.env.BENCH_KEEP_DB === '1'

for (const p of [DB, `${DB}-wal`, `${DB}-shm`]) if (!KEEP_DB) fs.rmSync(p, { force: true })
fs.rmSync(THUMBS, { recursive: true, force: true })
fs.mkdirSync(DATA, { recursive: true })

const { createLocalServices } = require('../dist-main/local.js')
const { FaceAnalysis } = require('../dist-main/ml/faceAnalysis.js')
const { scanFolder } = require('../dist-main/scanner.js')
const { decodeRgb } = require('../dist-main/ml/image.js')

const TARGET = [
  '2026_08_08_08_23_IMG_0594.JPG',
  '2026_08_08_08_23_IMG_0603.JPG',
  'DSC02042.JPG',
  'DSC02048.JPG',
  'DSC02052.JPG',
  'DSC02166.JPG',
]
const GROUND_TRUTH = {
  '2026_08_08_08_23_IMG_0594.JPG': 16,
  // IMG_0603 + DSC02042 have no annotated ground truth yet (marked '?').
  'DSC02048.JPG': 30,
  'DSC02052.JPG': 12,
  'DSC02166.JPG': 15,
}

// Size buckets (face side px) — aligns with the quality-tier policy:
// >100 / 64-100 / 32-64 / 20-32 / <20 (very_low below 20).
const BUCKETS = [
  { name: '>100', min: 101 },
  { name: '64-100', min: 65, max: 100 },
  { name: '32-64', min: 33, max: 64 },
  { name: '20-32', min: 21, max: 32 },
  { name: '<20', min: 1, max: 20 },
]
function bucketOf(side) {
  for (const b of BUCKETS) if (side >= b.min && side <= (b.max ?? 1e9)) return b.name
  return '?'
}

const OPTIONS = {
  fullDetThresh: Number(process.env.BENCH_FULL_THRESH ?? 0.5),
  tileDetThresh: Number(process.env.BENCH_TILE_THRESH ?? 0.5),
  reDetectFacePx: Number(process.env.BENCH_RE_PX ?? 80),
  nmsIou: Number(process.env.BENCH_NMS_IOU ?? 0.3),
  minFacePx: Number(process.env.BENCH_MIN_PX ?? 16),
  minFaceScore: Number(process.env.BENCH_MIN_SCORE ?? 0.3),
  tileOverlap: Number(process.env.BENCH_OVERLAP ?? 0),
  embed: process.env.BENCH_NO_EMBED !== '1',
  embedLow: process.env.BENCH_EMBED_LOW === '1',
  debugLog: process.env.BENCH_DEBUG === '1',
}

const label = JSON.stringify(OPTIONS)

// Skip detection/scan and only run the recognition-usefulness proxy against
// an existing bench DB (e.g. after fixing the proxy code).
const ONLY_USEFUL = process.env.BENCH_ONLY_USEFUL === '1'

async function main() {
  const services = createLocalServices({ dbPath: DB, thumbDir: THUMBS })
  const { store } = services

  if (ONLY_USEFUL) {
    const Database = require('better-sqlite3')
    const db = new Database(DB, { readonly: true })
    runUsefulnessProxy(db)
    db.close()
    return
  }
  const analysis = await FaceAnalysis.create(OPTIONS)

  const files = TARGET.map((f) => path.join(PHOTOS, f))

  console.log(`=== CONFIG ${label} ===`)

  // ---- Per-size-bucket aggregation (detected only, no DB yet) ----
  const buckets = new Map() // bucket -> { n, embedded, quality: {high,medium,low,very_low} }
  for (const b of BUCKETS) buckets.set(b.name, { n: 0, embedded: 0, quality: { high: 0, medium: 0, low: 0, very_low: 0 } })

  // ---- Per-photo detection benchmark (no DB) ----
  console.log('=== PER-PHOTO DETECTION ===')
  const summary = { detected: 0, expected: 0, missed: 0, fp: 0, totalMs: 0 }
  const rows = []
  for (const f of files) {
    const base = path.basename(f)
    try {
      const img = await decodeRgb(f)
      const t0 = Date.now()
      const faces = await analysis.detectFromImage(img)
      const totalMs = Date.now() - t0
      const timings = analysis.lastTimings
      const bd = analysis.lastBreakdown
      const sizes = faces.map((x) => x.bbox[2] - x.bbox[0])
      const qTiers = { high: 0, medium: 0, low: 0, very_low: 0 }
      for (const f of faces) qTiers[f.quality] += 1
      const embedded = faces.filter((f) => f.embedding !== null).length
      const exp = GROUND_TRUTH[base] ?? '?'
      const missed = exp === '?' ? '?' : Math.max(0, exp - faces.length)
      const fp = exp === '?' ? '?' : Math.max(0, faces.length - exp)
      if (exp !== '?') {
        summary.detected += faces.length
        summary.expected += exp
        summary.missed += missed
        summary.fp += fp
        summary.totalMs += totalMs
      }
      for (const f of faces) {
        const side = f.bbox[2] - f.bbox[0]
        const b = buckets.get(bucketOf(side))
        if (!b) continue
        b.n += 1
        if (f.embedding !== null) b.embedded += 1
        b.quality[f.quality] += 1
      }
      rows.push({ base, faces: faces.length, exp, missed, fp, totalMs, timings, bd, sizes, qTiers, embedded })
      console.log(`\n${base}`)
      console.log(`  faces=${faces.length} expected=${exp} missed=${missed} fp=${fp}`)
      console.log(`  quality: high=${qTiers.high} med=${qTiers.medium} low=${qTiers.low} veryLow=${qTiers.very_low}  embedded=${embedded}`)
      console.log(`  size dist: >100=${sizes.filter((s) => s > 100).length}  64-100=${sizes.filter((s) => s > 64 && s <= 100).length}  32-64=${sizes.filter((s) => s > 32 && s <= 64).length}  16-32=${sizes.filter((s) => s > 16 && s <= 32).length}  <16=${sizes.filter((s) => s <= 16).length}`)
      console.log(`  RAW -> NMS -> GATE -> FINAL: ${bd.rawFull}+${bd.rawTile} -> ${bd.afterNms} -> ${bd.afterGate} -> ${bd.final}  (rejected tiny=${bd.rejectedTiny} score=${bd.rejectedScore} kps=${bd.rejectedKps})`)
      console.log(`  time: full=${timings.fullImageMs}ms tile=${timings.tileMs}ms (${timings.tileRuns} runs) embed=${timings.embedMs}ms total=${totalMs}ms`)
    } catch (e) {
      console.log(`\n${base}: ERROR ${e.message}`)
    }
  }

  // ---- Summary table ----
  const fmt = (r) => `${r.faces}/${r.exp}`
  console.log(`\n=== SUMMARY ===`)
  console.log(`CONFIG: full=${OPTIONS.fullDetThresh} tile=${OPTIONS.tileDetThresh} rePx=${OPTIONS.reDetectFacePx} nms=${OPTIONS.nmsIou} minPx=${OPTIONS.minFacePx} minScore=${OPTIONS.minFaceScore} overlap=${OPTIONS.tileOverlap} embed=${OPTIONS.embed}`)
  console.log(`| photo    | DET/EXP | missed | fp | totalMs | tileRuns |`)
  for (const r of rows) {
    console.log(`| ${r.base.padEnd(9)} | ${String(fmt(r)).padEnd(7)} | ${String(r.missed).padEnd(6)} | ${String(r.fp).padEnd(3)} | ${String(r.totalMs).padEnd(7)} | ${r.timings.tileRuns} |`)
  }
  console.log(`| TOTAL    | ${summary.detected}/${summary.expected} | ${summary.missed} | ${summary.fp} | ${summary.totalMs}ms |`)
  const smallCount = rows.reduce((acc, r) => acc + r.sizes.filter((s) => s <= 32 && s >= 16).length, 0)
  const tinyCount = rows.reduce((acc, r) => acc + r.sizes.filter((s) => s < 16).length, 0)
  console.log(`small(16-32px) kept: ${smallCount}  tiny(<16px) kept: ${tinyCount}`)
  const totalEmbedded = rows.reduce((acc, r) => acc + r.embedded, 0)
  const totalDetected = rows.reduce((acc, r) => acc + r.faces, 0)
  console.log(`EMBEDDING: ${totalEmbedded}/${totalDetected} faces embedded (${Math.round((totalEmbedded / Math.max(1, totalDetected)) * 100)}%)`)
  const qAgg = rows.reduce((acc, r) => { acc.high += r.qTiers.high; acc.medium += r.qTiers.medium; acc.low += r.qTiers.low; acc.very_low += r.qTiers.very_low; return acc }, { high: 0, medium: 0, low: 0, very_low: 0 })
  console.log(`QUALITY TIERS (total): high=${qAgg.high} medium=${qAgg.medium} low=${qAgg.low} very_low=${qAgg.very_low}`)
  console.log(`precision=${(summary.expected / Math.max(1, summary.detected)).toFixed(3)}  recall=${((summary.expected - summary.missed) / summary.expected).toFixed(3)}  (expected/detected = rough precision proxy)`)

  // ---- Per-size-bucket table (detected / embedded) ----
  console.log(`\n=== PER-SIZE-BUCKET (detected) ===`)
  console.log(`| bucket | n | embedded | %emb | high | med | low | vlow |`)
  for (const [name, b] of buckets) {
    const pct = b.n ? Math.round((b.embedded / b.n) * 100) : 0
    console.log(`| ${name.padEnd(6)} | ${String(b.n).padStart(3)} | ${String(b.embedded).padStart(8)} | ${String(pct).padStart(3)}% | ${String(b.quality.high).padStart(4)} | ${String(b.quality.medium).padStart(3)} | ${String(b.quality.low).padStart(3)} | ${String(b.quality.very_low).padStart(4)} |`)
  }

  // ---- Scan ONLY the 3 targets (explicit file list) ----
  if (OPTIONS.embed) {
    console.log(`\n=== SCAN + CLUSTER (3 files) ===`)
    const t0 = Date.now()
    const summary2 = await scanFolder(store, PHOTOS, analysis, {
      thumbDir: THUMBS,
      files,
    })
    console.log(`photos=${summary2.scanned} faces=${summary2.totalFaces} persons=${summary2.persons} errors=${summary2.errors} elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s`)

    const Database = require('better-sqlite3')
    const db = new Database(DB, { readonly: true })
    const persons = db.prepare(`SELECT id, name FROM persons`).all()
    const faces = db.prepare(`SELECT f.person_id AS personId, f.embedding, f.low_quality AS lowQuality FROM faces f WHERE f.person_id IS NOT NULL`).all()
    const personFaces = new Map()
    for (const f of faces) {
      if (!personFaces.has(f.personId)) personFaces.set(f.personId, [])
      personFaces.get(f.personId).push(f.embedding)
    }
    const embeddedCount = db.prepare(`SELECT COUNT(*) AS n FROM faces WHERE embedding IS NOT NULL`).get().n
    const lowQualityCount = db.prepare(`SELECT COUNT(*) AS n FROM faces WHERE low_quality = 1`).get().n
    const totalFaces = db.prepare(`SELECT COUNT(*) AS n FROM faces`).get().n
    console.log(`\nfaces: ${totalFaces} total, ${embeddedCount} embedded, ${lowQualityCount} low_quality`)
    console.log(`persons: ${persons.length}`)
    const sizes = persons.map((p) => (personFaces.get(p.id) || []).length).sort((a, b) => b - a)
    const singletons = sizes.filter((s) => s === 1).length
    console.log(`cluster sizes: ${sizes.slice(0, 25).join(', ')}`)
    console.log(`singleton clusters: ${singletons}/${persons.length}`)

    runUsefulnessProxy(db)
    db.close()
  }
}

// ---- Per-size-bucket recognition-usefulness proxy ----
// "Recognition useful" = embedded AND has at least one cosine sim >= 0.5
// to another embedded face (i.e. it would actually join a cluster, not
// just be a lone singleton). Cheap pairwise pass over the DB.
function runUsefulnessProxy(db) {
  const { blobToEmbedding, cosine } = require('../dist-main/db/vec.js')
  const faceRows = db
    .prepare(`SELECT f.id, f.embedding, (f.x2 - f.x1) AS side, f.face_quality AS quality, f.low_quality AS lowQuality FROM faces f WHERE f.embedding IS NOT NULL`)
    .all()
    .map((r) => ({ ...r, embedding: blobToEmbedding(Buffer.from(r.embedding)) }))
  const matchThresh = 0.5
  const useful = new Map()
  for (const b of BUCKETS) useful.set(b.name, { embedded: 0, hasMatch: 0, noMatch: 0 })
  let usefulTotal = 0
  for (let i = 0; i < faceRows.length; i++) {
    const a = faceRows[i]
    const u = useful.get(bucketOf(a.side)) || { embedded: 0, hasMatch: 0, noMatch: 0 }
    u.embedded += 1
    let best = 0
    for (let j = 0; j < faceRows.length; j++) {
      if (i === j) continue
      const s = cosine(a.embedding, faceRows[j].embedding)
      if (s > best) best = s
      if (best >= matchThresh) break
    }
    if (best >= matchThresh) {
      u.hasMatch += 1
      usefulTotal += 1
    } else {
      u.noMatch += 1
    }
  }
  console.log(`\n=== RECOGNITION-USEFULNESS PROXY (embedded, best sim >= ${matchThresh}) ===`)
  console.log(`| bucket | embedded | hasMatch | noMatch | %useful |`)
  for (const [name, u] of useful) {
    const pct = u.embedded ? Math.round((u.hasMatch / u.embedded) * 100) : 0
    console.log(`| ${name.padEnd(6)} | ${String(u.embedded).padStart(8)} | ${String(u.hasMatch).padStart(8)} | ${String(u.noMatch).padStart(7)} | ${String(pct).padStart(7)}% |`)
  }
  console.log(`TOTAL useful (sim>=${matchThresh}): ${usefulTotal}/${faceRows.length}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
