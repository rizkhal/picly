/**
 * STEP 1-6: Cluster tuning benchmark — same/diff-person cross-photo similarity,
 * threshold sweep, and global vs quality-aware clustering, on a temp DB.
 *
 * Pipeline:
 *   1. Scan a sample of LFW identities (folder = ground-truth person) + optional
 *      psdkp-sample-tile photos into a temp DB.
 *   2. Build PAIR DATASET from the DB:
 *        SAME-PERSON pairs: two faces from the same identity folder
 *        DIFF-PERSON pairs: faces from different identity folders (incl. visually
 *        similar people — LFW folders contain lookalikes)
 *      Each pair carries: similarity, faceSizeA/B, qualityA/B, photoA/B.
 *   3. Distributions (min/P1/P5/P10/P25/med/P75/P90/P95/P99/max), overall and
 *      stratified by quality-pair (HIGH↔HIGH, HIGH↔MED, HIGH↔LOW, MED↔MED,
 *      MED↔LOW, LOW↔LOW).
 *   4. Threshold sweep 0.35-0.65 on the pair dataset (AUC-style): genuine accept
 *      rate, false accept rate, precision, F1 — plus cluster-level metrics via
 *      re-running the HAC on the temp DB at each threshold.
 *   5. Global vs quality-aware: replicate the store's HAC logic in-memory so we
 *      can sweep freely without touching the real store.
 *   6. Output: tables + JSON, plus false-merge / false-split examples.
 *
 * Usage:
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/cluster-tune.cjs
 *
 * Env:
 *   LFW_ROOT     path to lfw_funneled dir (default /Volumes/X/Dataset/lfw/lfw_funneled)
 *   SAMPLE_DIR   optional psdkp-sample-tile dir to include (crowded outdoor photos)
 *   MAX_IDENTS   max LFW identities to scan (default 40)
 *   PER_IDENT    photos per identity (default 6)
 */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { PhotoStore } = require('../dist-main/db/store.js')
const { FaceAnalysis } = require('../dist-main/ml/faceAnalysis.js')
const { scanFolder } = require('../dist-main/scanner.js')

const LFW_ROOT = process.env.LFW_ROOT || '/Volumes/X/Dataset/lfw/lfw_funneled'
const SAMPLE_DIR = process.env.SAMPLE_DIR || path.join(__dirname, '..', '..', 'data', 'psdkp-sample-tile')
const MAX_IDENTS = Number(process.env.MAX_IDENTS ?? 40)
const PER_IDENT = Number(process.env.PER_IDENT ?? 6)

const OUT_DIR = path.join(__dirname, '..', 'data', 'debug')
fs.mkdirSync(OUT_DIR, { recursive: true })
const OUT_JSON = path.join(OUT_DIR, 'cluster-tune.json')

const THRESHOLDS = [0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65]

// ---------- utils ----------
const cosine = (a, b) => {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  const d = Math.sqrt(na) * Math.sqrt(nb)
  return d > 0 ? dot / d : 0
}
const q = (arr, p) => {
  if (!arr.length) return NaN
  const s = arr.slice().sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)))]
}
const fmt = (arr) => {
  if (!arr.length) return '  n/a'
  return `n=${String(arr.length).padStart(5)} min=${q(arr, 0).toFixed(3)} p1=${q(arr, 0.01).toFixed(3)} p5=${q(arr, 0.05).toFixed(3)} p10=${q(arr, 0.1).toFixed(3)} p25=${q(arr, 0.25).toFixed(3)} med=${q(arr, 0.5).toFixed(3)} p75=${q(arr, 0.75).toFixed(3)} p90=${q(arr, 0.9).toFixed(3)} p95=${q(arr, 0.95).toFixed(3)} p99=${q(arr, 0.99).toFixed(3)} max=${q(arr, 1).toFixed(3)}`
}
const sideOf = (b) => Math.max(b[2] - b[0], b[3] - b[1])
const qualPair = (qa, qb) => {
  const order = ['high', 'medium', 'low', 'very_low']
  const [a, b] = [qa, qb].map((x) => order.indexOf(x)).sort((x, y) => x - y)
  return `${order[a]}↔${order[b]}`
}

// Ground-truth label: ONLY LFW folder under lfw_funneled is a valid identity
// label. psdkp-sample-tile has NO identity labels (crowded group photos, many
// different people) — its faces must never be paired as "same person".
function gtLabel(p) {
  const m = String(p).match(/lfw_funneled[\\/]([^\\/]+)[\\/]/)
  return m ? m[1] : null
}

// ---------- DB scan ----------
async function scanSample(store, analysis) {
  const thumbDir = path.join(os.tmpdir(), 'picly-tune-thumbs')
  fs.mkdirSync(thumbDir, { recursive: true })

  const files = []
  let nDirs = 0
  if (fs.existsSync(LFW_ROOT)) {
    // Prefer identities that actually have multiple photos — same-person pairs
    // require >=2 photos of the same person. LFW has ~900 folders with >=3.
    const allDirs = fs.readdirSync(LFW_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
    const dense = allDirs
      .map((name) => ({ name, n: fs.readdirSync(path.join(LFW_ROOT, name)).filter((f) => /\.(jpe?g)$/i.test(f) && !f.startsWith('._')).length }))
      .filter((c) => c.n >= 2)
      .sort((a, b) => b.n - a.n)
      .slice(0, MAX_IDENTS)
    nDirs = dense.length
    for (const { name } of dense) {
      const dir = path.join(LFW_ROOT, name)
      const imgs = fs.readdirSync(dir)
        .filter((f) => /\.(jpe?g)$/i.test(f) && !f.startsWith('._'))
        .slice(0, PER_IDENT)
        .map((f) => path.join(dir, f))
      files.push(...imgs)
    }
    console.log(`LFW: ${files.length} files from ${dense.length} identities (>=2 photos, ${MAX_IDENTS} max x ${PER_IDENT})`)
  } else {
    console.log(`LFW_ROOT missing (${LFW_ROOT}), skipping LFW`)
  }
  if (fs.existsSync(SAMPLE_DIR)) {
    const imgs = fs.readdirSync(SAMPLE_DIR).filter((f) => /\.(jpe?g)$/i.test(f) && !f.startsWith('._')).map((f) => path.join(SAMPLE_DIR, f))
    files.push(...imgs)
    console.log(`SAMPLE: +${imgs.length} psdkp-sample-tile photos`)
  }

  // Scan in chunks to keep progress visible.
  const summary = await scanFolder(store, LFW_ROOT, analysis, {
    thumbDir,
    files,
    onProgress: (p) => {
      if (p.processed % 20 === 0 || p.processed === p.total) {
        console.log(`  [${p.processed}/${p.total}] faces=${p.totalFaces}`)
      }
    },
  })
  console.log(`scan: total=${summary.total} faces=${summary.totalFaces} persons=${summary.persons} errors=${summary.errors}`)
}

// ---------- pair dataset ----------
function buildPairs(store) {
  const db = store.db
  const rows = db.prepare(`
    SELECT f.id AS faceId, f.photo_id AS photoId, f.embedding, f.face_quality AS q, f.quality_score AS qScore, p.path
    FROM faces f JOIN photos p ON p.id = f.photo_id
    WHERE f.embedding IS NOT NULL
  `).all()
  const faces = rows.map((r) => ({
    id: r.faceId,
    photoId: r.photoId,
    emb: new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4),
    q: r.q,
    qScore: r.qScore,
    path: r.path,
    label: gtLabel(r.path),
    side: 0,
  }))
  const bboxRows = db.prepare(`SELECT id, x1, y1, x2, y2 FROM faces WHERE embedding IS NOT NULL`).all()
  const sideById = new Map(bboxRows.map((r) => [r.id, Math.max(r.x2 - r.x1, r.y2 - r.y1)]))
  for (const f of faces) f.side = sideById.get(f.id) ?? 0

  const labeled = faces.filter((f) => f.label)
  // LFW convention: the SUBJECT is the largest face in the photo (LFW photos
  // are single-person portraits; extra small faces are background noise and
  // must NOT be treated as the identity).
  const byPhoto = new Map()
  for (const f of labeled) {
    if (!byPhoto.has(f.photoId)) byPhoto.set(f.photoId, [])
    byPhoto.get(f.photoId).push(f)
  }
  const subjects = []
  for (const [photoId, fs] of byPhoto) {
    fs.sort((a, b) => b.side - a.side)
    subjects.push(fs[0]) // largest face = the labeled person
  }
  const byLabel = new Map()
  for (const f of subjects) {
    if (!byLabel.has(f.label)) byLabel.set(f.label, [])
    byLabel.get(f.label).push(f)
  }

  const same = []
  const diff = []
  for (const [label, fs] of byLabel) {
    for (let i = 0; i < fs.length; i++) {
      for (let j = i + 1; j < fs.length; j++) {
        same.push({
          label, a: fs[i], b: fs[j],
          sim: cosine(fs[i].emb, fs[j].emb),
          crossPhoto: fs[i].photoId !== fs[j].photoId,
        })
      }
    }
  }
  const labels = [...byLabel.keys()]
  for (let a = 0; a < labels.length; a++) {
    for (let b = a + 1; b < labels.length; b++) {
      const fa = byLabel.get(labels[a])
      const fb = byLabel.get(labels[b])
      for (const x of fa) for (const y of fb) {
        diff.push({ labelA: labels[a], labelB: labels[b], a: x, b: y, sim: cosine(x.emb, y.emb), crossPhoto: x.photoId !== y.photoId })
      }
    }
  }

  // Within-photo DIFF pairs in UNLABELED (psdkp) photos — the crowded-scene
  // false-merge risk: faces in the same photo that are different people.
  const unlabeledByPhoto = new Map()
  for (const f of faces) {
    if (f.label) continue // only unlabeled (psdkp) faces
    if (!unlabeledByPhoto.has(f.photoId)) unlabeledByPhoto.set(f.photoId, [])
    unlabeledByPhoto.get(f.photoId).push(f)
  }
  const withinPhotoDiff = []
  for (const [photoId, fs] of unlabeledByPhoto) {
    for (let i = 0; i < fs.length; i++) {
      for (let j = i + 1; j < fs.length; j++) {
        withinPhotoDiff.push({ photoId, a: fs[i], b: fs[j], sim: cosine(fs[i].emb, fs[j].emb) })
      }
    }
  }
  return { faces, subjects, same, diff, withinPhotoDiff }
}

// ---------- in-memory HAC (mirror store.clusterAllFaces) ----------
function runHAC(faces, threshold, opts = {}) {
  const {
    anchorThreshold = threshold,   // HIGH/MED anchors normal
    lowJoinSim = 0.6,              // LOW face join threshold
    lowLowSim = 0.65,              // LOW↔LOW must be even stronger
  } = opts
  const m = faces.length
  const parent = Array.from({ length: m }, (_, i) => i)
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
  const centroid = faces.map((f) => new Float32Array(f.emb))
  const size = new Array(m).fill(1)

  const canJoin = (ia, ib, s) => {
    const qa = faces[ia].q
    const qb = faces[ib].q
    if (qa === 'very_low' || qb === 'very_low') return false // never
    if (qa === 'low' && qb === 'low') return s >= lowLowSim
    if (qa === 'low' || qb === 'low') return s >= lowJoinSim
    return s >= anchorThreshold
  }

  // Merge two clusters: returns the new root. centroid[r] updated to the
  // weighted mean of the two cluster centroids.
  const merge = (a, b) => {
    const ra = find(a)
    const rb = find(b)
    if (ra === rb) return ra
    const ca = centroid[ra]
    const cb = centroid[rb]
    const nA = size[ra]
    const nB = size[rb]
    // Keep the root with larger size (or a if equal) as the surviving root.
    let root, child
    if (nA >= nB) { root = ra; child = rb } else { root = rb; child = ra }
    parent[child] = root
    const nRoot = size[root]
    const nChild = size[child]
    const nc = new Float32Array(512)
    for (let k = 0; k < 512; k++) nc[k] = (centroid[root][k] * nRoot + centroid[child][k] * nChild) / (nRoot + nChild)
    centroid[root] = nc
    size[root] = nRoot + nChild
    return root
  }

  const sims = []
  for (let i = 0; i < m; i++) {
    for (let j = i + 1; j < m; j++) {
      sims.push({ a: i, b: j, s: cosine(faces[i].emb, faces[j].emb) })
    }
  }
  sims.sort((x, y) => y.s - x.s)

  for (const { a, b, s } of sims) {
    if (s < threshold) break
    if (!canJoin(a, b, s)) continue
    const ra = find(a)
    const rb = find(b)
    if (ra === rb) continue
    const ca = centroid[ra]
    const cb = centroid[rb]
    if (cosine(ca, cb) < threshold) continue
    merge(a, b)
  }

  const clusters = new Map()
  for (let i = 0; i < m; i++) {
    const r = find(i)
    if (!clusters.has(r)) clusters.set(r, [])
    clusters.get(r).push(i)
  }
  return [...clusters.values()]
}

// ---------- cluster-level metrics vs ground truth ----------
/**
 * Given a clustering (array of face-index groups) and the true label of each
 * face, compute precision/recall/false-merge/false-split.
 *
 * Purity-style metrics over pairs: for each pair of faces in the same cluster
 * (predicted same), count whether they share a label (TP) or not (FP).
 * For pairs in different clusters (predicted different), count whether they
 * share a label (FN → false split) or not (TN).
 */
function clusterMetrics(clusters, labels) {
  const m = labels.length
  const clusIdx = new Map()
  clusters.forEach((members, ci) => members.forEach((i) => clusIdx.set(i, ci)))
  let tp = 0, fp = 0, fn = 0
  for (let i = 0; i < m; i++) {
    for (let j = i + 1; j < m; j++) {
      // Unlabeled faces (psdkp background, no GT identity) never count as
      // same/diff — they are excluded from pair metrics entirely.
      if (!labels[i] || !labels[j]) continue
      const sameGT = labels[i] === labels[j]
      const samePred = clusIdx.get(i) === clusIdx.get(j)
      if (sameGT && samePred) tp++
      else if (!sameGT && samePred) fp++
      else if (sameGT && !samePred) fn++
    }
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0
  return { tp, fp, fn, precision, recall, f1 }
}

// ---------- main ----------
async function main() {
  const dbPath = path.join(os.tmpdir(), `picly-tune-${Date.now()}.db`)
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { fs.rmSync(p, { force: true }) } catch {} }
  const store = PhotoStore.open(dbPath)
  const analysis = await FaceAnalysis.create()

  await scanSample(store, analysis)

  const { faces, subjects, same, diff, withinPhotoDiff } = buildPairs(store)
  console.log(`\nfaces=${faces.length} subjects=${subjects.length} same-pairs=${same.length} diff-pairs=${diff.length} within-photo-diff=${withinPhotoDiff.length}`)

  // ---- STEP 2: distributions ----
  const sameCross = same.filter((p) => p.crossPhoto)
  const sameSamePhoto = same.filter((p) => !p.crossPhoto)
  const diffCross = diff.filter((p) => p.crossPhoto)
  const diffSamePhoto = diff.filter((p) => !p.crossPhoto)

  console.log(`\n=== SAME-PERSON (cross-photo) ===`)
  console.log(fmt(sameCross.map((p) => p.sim)))
  console.log(`\n=== SAME-PERSON (same-photo, duplicates/back-to-back) ===`)
  console.log(fmt(sameSamePhoto.map((p) => p.sim)))
  console.log(`\n=== DIFF-PERSON (cross-photo) ===`)
  console.log(fmt(diffCross.map((p) => p.sim)))
  console.log(`\n=== DIFF-PERSON (same-photo) ===`)
  console.log(fmt(diffSamePhoto.map((p) => p.sim)))

  // Stratify by quality pair (use cross-photo same pairs only for pos).
  const posByQ = new Map()
  const negByQ = new Map()
  for (const p of sameCross) {
    const k = qualPair(p.a.q, p.b.q)
    if (!posByQ.has(k)) posByQ.set(k, [])
    posByQ.get(k).push(p.sim)
  }
  for (const p of diffCross) {
    const k = qualPair(p.a.q, p.b.q)
    if (!negByQ.has(k)) negByQ.set(k, [])
    negByQ.get(k).push(p.sim)
  }
  const qKeys = ['high↔high', 'high↔medium', 'high↔low', 'medium↔medium', 'medium↔low', 'low↔low']
  console.log(`\n=== SAME-PERSON by quality pair (cross-photo) ===`)
  for (const k of qKeys) console.log(`${k.padEnd(14)} | pos ${fmt(posByQ.get(k) || [])}`)
  console.log(`\n=== DIFF-PERSON by quality pair (cross-photo) ===`)
  for (const k of qKeys) console.log(`${k.padEnd(14)} | neg ${fmt(negByQ.get(k) || [])}`)

  // ---- STEP 3: threshold sweep on PAIR level ----
  console.log(`\n=== THRESHOLD SWEEP (pair-level, all same/diff pairs) ===`)
  const sweep = []
  const allSame = same.map((p) => p.sim)
  const allDiff = diff.map((p) => p.sim)
  for (const t of THRESHOLDS) {
    const tp = allSame.filter((s) => s >= t).length
    const fn = allSame.length - tp
    const fp = allDiff.filter((s) => s >= t).length
    const tn = allDiff.length - fp
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0
    const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0
    const far = allDiff.length > 0 ? fp / allDiff.length : 0
    sweep.push({ t, tp, fp, fn, tn, precision, recall, f1, far })
    console.log(`thr=${t.toFixed(2)}  TP=${String(tp).padStart(4)} FP=${String(fp).padStart(4)} FN=${String(fn).padStart(4)}  prec=${precision.toFixed(3)} recall=${recall.toFixed(3)} F1=${f1.toFixed(3)} FAR=${far.toFixed(4)}`)
  }

  // Crowded-scene false-merge risk: within-photo diff pairs in psdkp that would
  // wrongly merge at each threshold.
  console.log(`\n=== CROWDED-PHOTO FALSE-MERGE RISK (within-photo diff pairs, psdkp) ===`)
  const wpSims = withinPhotoDiff.map((p) => p.sim)
  console.log(`within-photo diff pairs: ${wpSims.length}  med=${q(wpSims, 0.5).toFixed(3)} p90=${q(wpSims, 0.9).toFixed(3)} p95=${q(wpSims, 0.95).toFixed(3)} p99=${q(wpSims, 0.99).toFixed(3)} max=${q(wpSims, 1).toFixed(3)}`)
  for (const t of THRESHOLDS) {
    const risky = wpSims.filter((s) => s >= t).length
    console.log(`  thr=${t.toFixed(2)}: ${risky} pairs (${(100 * risky / Math.max(1, wpSims.length)).toFixed(3)}%) would false-merge`)
  }

  // ---- STEP 5: global vs quality-aware (cluster-level) ----
  // HAC runs on ALL faces (realistic: background + subjects), but metrics are
  // evaluated only on SUBJECT faces (LFW portrait subject = ground truth).
  console.log(`\n=== GLOBAL vs QUALITY-AWARE (cluster-level on all faces, eval on subjects) ===`)
  const subjectIdx = new Set(subjects.map((s) => faces.indexOf(s)))
  const evalLabels = faces.map((f, i) => (subjectIdx.has(i) ? f.label : null))
  const configs = [
    { name: 'global 0.35', threshold: 0.35, mode: 'global' },
    { name: 'global 0.40', threshold: 0.40, mode: 'global' },
    { name: 'global 0.45', threshold: 0.45, mode: 'global' },
    { name: 'global 0.50', threshold: 0.50, mode: 'global' },
    { name: 'global 0.55', threshold: 0.55, mode: 'global' },
    { name: 'global 0.60', threshold: 0.60, mode: 'global' },
    { name: 'global 0.65', threshold: 0.65, mode: 'global' },
    { name: 'QA anchor0.50/lowJoin0.55', threshold: 0.50, mode: 'qa', anchorThreshold: 0.50, lowJoinSim: 0.55 },
    { name: 'QA anchor0.50/lowJoin0.60', threshold: 0.50, mode: 'qa', anchorThreshold: 0.50, lowJoinSim: 0.60 },
    { name: 'QA anchor0.45/lowJoin0.55', threshold: 0.45, mode: 'qa', anchorThreshold: 0.45, lowJoinSim: 0.55 },
    { name: 'QA anchor0.45/lowJoin0.60', threshold: 0.45, mode: 'qa', anchorThreshold: 0.45, lowJoinSim: 0.60 },
  ]
  const results = []
  for (const c of configs) {
    const opts = c.mode === 'qa' ? { anchorThreshold: c.anchorThreshold, lowJoinSim: c.lowJoinSim } : {}
    const clusters = runHAC(faces, c.threshold, opts)
    const met = clusterMetrics(clusters, evalLabels)
    const nClusters = clusters.length
    const singletons = clusters.filter((c2) => c2.length === 1).length
    // per-identity purity: fraction of faces whose dominant label matches
    let pureCount = 0
    let totalCount = 0
    for (const c2 of clusters) {
      const labelCounts = new Map()
      for (const i of c2) {
        const l = evalLabels[i]
        if (l) labelCounts.set(l, (labelCounts.get(l) || 0) + 1)
      }
      const total = [...labelCounts.values()].reduce((a, b) => a + b, 0)
      if (total > 0) {
        const dom = [...labelCounts.entries()].reduce((a, b) => (b[1] > a[1] ? b : a), ['', 0])
        pureCount += dom[1]
        totalCount += total
      }
    }
    const purity = totalCount > 0 ? pureCount / totalCount : 0
    results.push({ name: c.name, ...met, nClusters, singletons, purity })
    console.log(`  ${c.name.padEnd(28)} prec=${met.precision.toFixed(3)} recall=${met.recall.toFixed(3)} F1=${met.f1.toFixed(3)} clus=${String(nClusters).padStart(4)} sing=${String(singletons).padStart(4)} purity=${purity.toFixed(3)}`)
  }

  // ---- STEP 6: false-merge / false-split examples (best QA config) ----
  const bestQA = configs.find((c) => c.name === 'QA anchor0.45/lowJoin0.55')
  const clustersQA = runHAC(faces, bestQA.threshold, { anchorThreshold: bestQA.anchorThreshold, lowJoinSim: bestQA.lowJoinSim })
  const labelsQA = evalLabels
  const fmExamples = []
  const fsExamples = []
  for (const c of clustersQA) {
    if (c.length < 2) continue
    const labelCounts = new Map()
    for (const i of c) labelCounts.set(labelsQA[i], (labelCounts.get(labelsQA[i]) || 0) + 1)
    const dom = [...labelCounts.entries()].reduce((a, b) => (b[1] > a[1] ? b : a), ['', 0])
    const minority = [...labelCounts.entries()].filter(([l]) => l && l !== dom[0])
    if (minority.length > 0) {
      fmExamples.push({ clusterSize: c.length, dominant: dom[0], minority: minority.map(([l, n]) => `${l}(${n})`).slice(0, 3) })
    }
  }
  // false split: same identity appearing in 2+ clusters
  const labelClusters = new Map()
  for (const c of clustersQA) {
    const ls = new Set(c.map((i) => labelsQA[i]).filter(Boolean))
    for (const l of ls) {
      if (!labelClusters.has(l)) labelClusters.set(l, new Set())
      labelClusters.get(l).add(c.length)
    }
  }
  for (const [label, sizes] of labelClusters) {
    if (sizes.size > 1) fsExamples.push({ label, nClusters: sizes.size, sizes: [...sizes].slice(0, 5) })
  }
  console.log(`\n=== FALSE MERGE examples (QA anchor0.45/lowJoin0.55) ===`)
  for (const e of fmExamples.slice(0, 8)) console.log(`  cluster size=${e.clusterSize} dominant=${e.dominant} minority=${e.minority.join(', ')}`)
  console.log(`\n=== FALSE SPLIT examples ===`)
  for (const e of fsExamples.slice(0, 8)) console.log(`  label=${e.label} clusters=${e.nClusters} sizes=${e.sizes.join(',')}`)

  // Save JSON
  fs.writeFileSync(OUT_JSON, JSON.stringify({
    faces: faces.length, same: same.length, diff: diff.length,
    sameCross: sameCross.map((p) => ({ sim: p.sim, qa: p.a.q, qb: p.b.q, cross: p.crossPhoto, label: p.label })),
    diffCross: diffCross.map((p) => ({ sim: p.sim, qa: p.a.q, qb: p.b.q, cross: p.crossPhoto })),
    sweep, results,
    withinPhotoDiff: withinPhotoDiff.map((p) => ({ sim: p.sim, qa: p.a.q, qb: p.b.q })),
    falseMerge: fmExamples.slice(0, 10),
    falseSplit: fsExamples.slice(0, 10),
  }, null, 2))
  console.log(`\nJSON: ${OUT_JSON}`)

  store.close()
  try { fs.rmSync(dbPath, { force: true }) } catch {}
}

main().catch((e) => { console.error(e); process.exit(1) })
