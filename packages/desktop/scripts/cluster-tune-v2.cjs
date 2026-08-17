/**
 * Cluster tuning v2 — identity-level benchmark 0.50 vs 0.45 on a larger
 * production-like dataset (crowded outdoor group photos, phone/drone).
 *
 * Data sources:
 *   1. LFW (folder = ground truth identity) — clean labeled pairs
 *   2. all_images_processed (rename_X = person folder with representative
 *      face + originals) — ground truth for the psdkp-sample-tile crowd photos
 *   3. psdkp (418 phone photos) — larger crowded outdoor set (no labels)
 *   4. psdkp-sample-tile — original 8-photo sample
 *
 * Output: per-config identity-level metrics + same-person recovery stratified
 * by face size, JSON to packages/desktop/data/debug/cluster-tune-v2.json
 *
 * Usage:
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/cluster-tune-v2.cjs
 *
 * Env:
 *   LFW_ROOT          (default /Volumes/X/Dataset/lfw/lfw_funneled)
 *   MAX_IDENTS        LFW identities to scan (default 40)
 *   PER_IDENT         photos per LFW identity (default 6)
 *   PSDKP_DIR         psdkp dir to include (default /Volumes/X/Dataset/psdkp)
 *   PSDKP_MAX         max psdkp photos to scan (default 60, subset for time)
 *   GT_DIR            all_images_processed dir (default /Volumes/X/Dataset/all_images_processed)
 *   SAMPLE_DIR        psdkp-sample-tile dir (default <repo>/data/psdkp-sample-tile)
 */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { PhotoStore } = require('../dist-main/db/store.js')
const { FaceAnalysis } = require('../dist-main/ml/faceAnalysis.js')
const { scanFolder } = require('../dist-main/scanner.js')

const LFW_ROOT = process.env.LFW_ROOT || '/Volumes/X/Dataset/lfw/lfw_funneled'
const SAMPLE_DIR = process.env.SAMPLE_DIR || path.join(__dirname, '..', '..', 'data', 'psdkp-sample-tile')
const GT_DIR = process.env.GT_DIR || '/Volumes/X/Dataset/all_images_processed'
const PSDKP_DIR = process.env.PSDKP_DIR || '/Volumes/X/Dataset/psdkp'
const MAX_IDENTS = Number(process.env.MAX_IDENTS ?? 40)
const PER_IDENT = Number(process.env.PER_IDENT ?? 6)
const PSDKP_MAX = Number(process.env.PSDKP_MAX ?? 60)

const OUT_DIR = path.join(__dirname, '..', 'data', 'debug')
fs.mkdirSync(OUT_DIR, { recursive: true })
const OUT_JSON = path.join(OUT_DIR, 'cluster-tune-v2.json')

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

// Ground-truth label resolver: LFW folder, or all_images_processed rename_X.
// IMPORTANT: a face is a label CANDIDATE only when the file lives under an
// identity folder. Group photos (e.g. IMG_0594.JPG under rename_X) contain
// MANY different people — only the LARGEST face per photo (or the
// representative-face crop) is the folder's subject; everything else is
// background and must NOT be labeled (else we fabricate same-person pairs).
function gtLabel(p) {
  const s = String(p)
  const lfw = s.match(/lfw_funneled[\\/]([^\\/]+)[\\/]/)
  if (lfw) return lfw[1]
  const rename = s.match(/all_images_processed[\\/](rename_\d+)[\\/]/)
  if (rename && /representative_face/.test(s)) return rename[1]
  return null
}

// ---------- DB scan ----------
async function scanSample(store, analysis) {
  const thumbDir = path.join(os.tmpdir(), 'picly-tune-thumbs-v2')
  fs.mkdirSync(thumbDir, { recursive: true })
  const files = []
  let nDirs = 0

  // 1. LFW identities
  if (fs.existsSync(LFW_ROOT)) {
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
    console.log(`LFW: ${files.length} files from ${dense.length} identities`)
  }

  // 2. all_images_processed rename_X folders (ground truth for crowd sample)
  if (fs.existsSync(GT_DIR)) {
    const dirs = fs.readdirSync(GT_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^rename_\d+$/.test(d.name))
    let n = 0
    for (const d of dirs) {
      const dir = path.join(GT_DIR, d.name)
      for (const f of fs.readdirSync(dir)) {
        if (/\.(jpe?g)$/i.test(f) && !f.startsWith('._') && !/representative_face/.test(f)) {
          files.push(path.join(dir, f)); n++
        }
      }
    }
    console.log(`GT(rename_X): +${n} labeled crowd photos`)
  }

  // 3. psdkp-sample-tile (crowded outdoor, no labels but real use case)
  if (fs.existsSync(SAMPLE_DIR)) {
    const imgs = fs.readdirSync(SAMPLE_DIR).filter((f) => /\.(jpe?g)$/i.test(f) && !f.startsWith('._')).map((f) => path.join(SAMPLE_DIR, f))
    files.push(...imgs)
    console.log(`SAMPLE: +${imgs.length} psdkp-sample-tile photos`)
  }

  // 4. psdkp subset (larger crowded outdoor, no labels)
  if (fs.existsSync(PSDKP_DIR)) {
    const all = fs.readdirSync(PSDKP_DIR).filter((f) => /\\.(jpe?g)$/i.test(f) && !f.startsWith('._'))
    const imgs = all.slice(0, PSDKP_MAX).map((f) => path.join(PSDKP_DIR, f))
    files.push(...imgs)
    console.log(`PSDKP: +${imgs.length} (of ${all.length}) crowded phone photos`)
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

// ---------- pair building (identity-aware) ----------
function buildPairs(store) {
  const rows = store.db
    .prepare(`
      SELECT f.id AS id, f.photo_id AS photoId, f.embedding AS emb, f.face_quality AS q,
             f.quality_score AS qScore, f.x1, f.y1, f.x2, f.y2, p.path AS path
      FROM faces f JOIN photos p ON p.id = f.photo_id
    `)
    .all()
  const faces = rows.map((r) => ({
    id: r.id, photoId: r.photoId, path: r.path,
    emb: r.emb ? Float32Array.from(new Float32Array(r.emb.buffer, r.emb.byteOffset, r.emb.byteLength / 4)) : null,
    q: r.q, qScore: r.qScore,
    bbox: [r.x1, r.y1, r.x2, r.y2],
    label: null,
    side: sideOf([r.x1, r.y1, r.x2, r.y2]),
  })).filter((f) => f.emb)

  const byPhoto = new Map()
  for (const f of faces) {
    if (!byPhoto.has(f.photoId)) byPhoto.set(f.photoId, [])
    byPhoto.get(f.photoId).push(f)
  }

  // --- LFW: per-photo largest face carries the folder label (verified rule:
  // the portrait subject is the dominant face; other faces are background). ---
  const lfwPhoto = new Map() // photoId -> { label, side }
  for (const f of faces) {
    const m = String(f.path).match(/lfw_funneled[\\/]([^\\/]+)[\\/]/)
    if (!m) continue
    const cur = lfwPhoto.get(f.photoId)
    if (!cur || f.side > cur.side) lfwPhoto.set(f.photoId, { label: m[1], side: f.side })
  }
  for (const f of faces) {
    const l = lfwPhoto.get(f.photoId)
    if (l && f.side === l.side) f.label = l.label
  }

  // --- all_images_processed: representative-face crops carry the folder
  // label; a face inside a folder's group photo is labeled only when its
  // embedding strongly matches that folder's crop (>= CROP_MATCH_SIM). This
  // avoids labeling background people just because they share the photo. ---
  const CROP_MATCH_SIM = 0.6
  const cropsByLabel = new Map() // label -> [crop faces]
  for (const f of faces) {
    const m = String(f.path).match(/all_images_processed[\\/](rename_\d+)[\\/]([^\\/]*representative_face[^\\/]*)$/)
    if (!m) continue
    f.label = m[1]
    if (!cropsByLabel.has(m[1])) cropsByLabel.set(m[1], [])
    cropsByLabel.get(m[1]).push(f)
  }
  for (const f of faces) {
    if (f.label) continue
    const m = String(f.path).match(/all_images_processed[\\/](rename_\d+)[\\/]/)
    if (!m) continue
    const crops = cropsByLabel.get(m[1])
    if (!crops || !crops.length) continue
    for (const c of crops) {
      if (cosine(f.emb, c.emb) >= CROP_MATCH_SIM) { f.label = m[1]; break }
    }
  }

  // Identity pairs — only among labeled faces (LFW + rename_X).
  const labeled = faces.filter((f) => f.label)
  const byLabel = new Map()
  for (const f of labeled) {
    if (!byLabel.has(f.label)) byLabel.set(f.label, [])
    byLabel.get(f.label).push(f)
  }

  const same = []
  const diff = []
  for (const [label, ls] of byLabel) {
    for (let i = 0; i < ls.length; i++) {
      for (let j = i + 1; j < ls.length; j++) {
        const a = ls[i], b = ls[j]
        same.push({ a, b, sim: cosine(a.emb, b.emb), crossPhoto: a.photoId !== b.photoId, label })
      }
    }
  }
  const labels = [...byLabel.keys()]
  for (let i = 0; i < labels.length; i++) {
    const fa = byLabel.get(labels[i])
    for (let j = i + 1; j < labels.length; j++) {
      const fb = byLabel.get(labels[j])
      for (const a of fa) for (const b of fb) {
        diff.push({ a, b, sim: cosine(a.emb, b.emb), crossPhoto: a.photoId !== b.photoId })
      }
    }
  }

  // Unlabeled faces (psdkp / sample) — only for within-photo diff pairs
  // (crowded-scene false-merge risk); never treated as same-person.
  const unlabeledByPhoto = new Map()
  for (const f of faces) {
    if (f.label) continue
    if (!unlabeledByPhoto.has(f.photoId)) unlabeledByPhoto.set(f.photoId, [])
    unlabeledByPhoto.get(f.photoId).push(f)
  }
  const withinPhotoDiff = []
  for (const ls of unlabeledByPhoto.values()) {
    for (let i = 0; i < ls.length; i++) {
      for (let j = i + 1; j < ls.length; j++) {
        withinPhotoDiff.push({ a: ls[i], b: ls[j], sim: cosine(ls[i].emb, ls[j].emb) })
      }
    }
  }

  return { faces, labeled, same, diff, withinPhotoDiff, byLabel }
}

// ---------- in-memory HAC (mirror store.clusterAllFaces) ----------
function runHAC(faces, threshold, opts = {}) {
  const { lowJoinSim = 0.6 } = opts
  const n = faces.length
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (x) => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] }
    return x
  }
  const centroid = faces.map((f) => Float32Array.from(f.emb))
  const size = new Array(n).fill(1)
  const canJoin = (ia, ib, s) => {
    const qa = faces[ia].q, qb = faces[ib].q
    if (qa === 'low' || qb === 'low') return s >= lowJoinSim
    return true
  }
  const sims = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = cosine(faces[i].emb, faces[j].emb)
      if (s < threshold) continue
      sims.push({ a: i, b: j, s })
    }
  }
  sims.sort((x, y) => y.s - x.s)
  const merge = (y, x) => {
    parent[y] = x
    const cy = centroid[y], cx = centroid[x]
    const ny = size[y], nx = size[x]
    for (let k = 0; k < cx.length; k++) cx[k] = (cx[k] * nx + cy[k] * ny) / (nx + ny)
    size[x] = nx + ny
  }
  for (const { a, b, s } of sims) {
    if (!canJoin(a, b, s)) continue
    const ra = find(a), rb = find(b)
    if (ra === rb) continue
    if (cosine(centroid[ra], centroid[rb]) < threshold) continue
    merge(size[ra] < size[rb] ? rb : ra, size[ra] < size[rb] ? ra : rb)
  }
  const clusters = new Map()
  for (let i = 0; i < n; i++) {
    const r = find(i)
    if (!clusters.has(r)) clusters.set(r, [])
    clusters.get(r).push(i)
  }
  return [...clusters.values()]
}

// ---------- identity-level metrics ----------
function identityMetrics(clusters, faces) {
  // For every pair of LABELED faces with the same label, did they end up in the
  // same cluster? For different labels, did they end up separated?
  const idx = new Map(faces.map((f, i) => [f.id, i]))
  const clusOf = new Array(faces.length)
  clusters.forEach((c, ci) => c.forEach((i) => { clusOf[i] = ci }))
  let tp = 0, fn = 0, fp = 0, tn = 0
  let sameTotal = 0, diffTotal = 0
  const sizeBuckets = [['>100', (s) => s > 100], ['64-100', (s) => s >= 64 && s <= 100], ['32-64', (s) => s >= 32 && s < 64], ['20-32', (s) => s >= 20 && s < 32], ['<20', (s) => s < 20]]
  const recBySize = {}
  sizeBuckets.forEach(([name]) => { recBySize[name] = { same: 0, recovered: 0 } })

  const labeled = faces.filter((f) => f.label)
  const byLabel = new Map()
  for (const f of labeled) { if (!byLabel.has(f.label)) byLabel.set(f.label, []); byLabel.get(f.label).push(f) }
  for (const [label, ls] of byLabel) {
    for (let i = 0; i < ls.length; i++) {
      for (let j = i + 1; j < ls.length; j++) {
        sameTotal++
        const sames = clusOf[idx.get(ls[i].id)] === clusOf[idx.get(ls[j].id)]
        if (sames) { tp++; } else { fn++; }
        // stratify by smaller face size
        const smaller = Math.min(ls[i].side, ls[j].side)
        const bucket = sizeBuckets.find(([, pred]) => pred(smaller))
        if (bucket) {
          recBySize[bucket[0]].same++
          if (sames) recBySize[bucket[0]].recovered++
        }
      }
    }
  }
  const labels = [...byLabel.keys()]
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      for (const a of byLabel.get(labels[i])) {
        for (const b of byLabel.get(labels[j])) {
          diffTotal++
          if (clusOf[idx.get(a.id)] === clusOf[idx.get(b.id)]) fp++
          else tn++
        }
      }
    }
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0
  const purity = (() => {
    let pure = 0, total = 0
    for (const c of clusters) {
      const cnt = new Map()
      for (const i of c) { const l = faces[i].label; if (l) cnt.set(l, (cnt.get(l) || 0) + 1) }
      const tot = [...cnt.values()].reduce((a, b) => a + b, 0)
      if (tot > 0) { pure += Math.max(...cnt.values()); total += tot }
    }
    return total > 0 ? pure / total : 0
  })()
  return {
    samePairs: sameTotal, diffPairs: diffTotal,
    tp, fp, fn, tn,
    precision, recall, f1,
    purity,
    recBySize: Object.fromEntries(Object.entries(recBySize).map(([k, v]) => [k, v.same > 0 ? v.recovered / v.same : null])),
    recBySizeRaw: recBySize,
  }
}

async function main() {
  const dbPath = path.join(os.tmpdir(), `picly-tune-v2-${Date.now()}.db`)
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { fs.rmSync(p, { force: true }) } catch {} }
  const store = PhotoStore.open(dbPath)
  const analysis = await FaceAnalysis.create()

  await scanSample(store, analysis)

  const { faces, labeled, same, diff, withinPhotoDiff } = buildPairs(store)
  console.log(`\nfaces=${faces.length} labeled=${labeled.length} same-pairs=${same.length} diff-pairs=${diff.length} within-photo-diff=${withinPhotoDiff.length}`)

  const sameCross = same.filter((p) => p.crossPhoto)
  const diffCross = diff.filter((p) => p.crossPhoto)

  console.log(`\n=== SAME-PERSON (cross-photo, labeled) ===`)
  console.log(fmt(sameCross.map((p) => p.sim)))
  console.log(`\n=== DIFF-PERSON (cross-photo, labeled) ===`)
  console.log(fmt(diffCross.map((p) => p.sim)))
  console.log(`\n=== CROWDED within-photo diff (unlabeled psdkp/sample) ===`)
  console.log(fmt(withinPhotoDiff.map((p) => p.sim)))

  // ---- identity-level config comparison ----
  console.log(`\n=== IDENTITY-LEVEL: 0.50 vs 0.45 vs QA ===`)
  const configs = [
    { name: 'global 0.50 (current)', threshold: 0.50, mode: 'global' },
    { name: 'global 0.45 (candidate)', threshold: 0.45, mode: 'global' },
    { name: 'global 0.40', threshold: 0.40, mode: 'global' },
    { name: 'QA 0.45/lowJoin0.60', threshold: 0.45, mode: 'qa', lowJoinSim: 0.60 },
  ]
  const results = []
  for (const c of configs) {
    const clusters = runHAC(faces, c.threshold, c.mode === 'qa' ? { lowJoinSim: c.lowJoinSim } : {})
    const met = identityMetrics(clusters, faces)
    const singletons = clusters.filter((cl) => cl.length === 1).length
    results.push({ name: c.name, ...met, nClusters: clusters.length, singletons })
    console.log(`  ${c.name.padEnd(28)} recall=${met.recall.toFixed(3)} prec=${met.precision.toFixed(3)} F1=${met.f1.toFixed(3)} purity=${met.purity.toFixed(3)} clus=${String(clusters.length).padStart(4)} sing=${String(singletons).padStart(4)}`)
    console.log(`      same=${met.samePairs} tp=${met.tp} fn=${met.fn} | diff=${met.diffPairs} fp=${met.fp} tn=${met.tn}`)
    console.log(`      rec-by-size: ` + Object.entries(met.recBySize).map(([k, v]) => `${k}:${v === null ? 'n/a' : v.toFixed(2)}`).join(' '))
  }

  // within-photo false merge risk at each candidate
  console.log(`\n=== CROWDED within-photo false-merge risk ===`)
  const wp = withinPhotoDiff.map((p) => p.sim)
  for (const t of [0.40, 0.45, 0.50]) {
    const risky = wp.filter((s) => s >= t).length
    console.log(`  thr=${t.toFixed(2)}: ${risky} / ${wp.length} (${(100 * risky / Math.max(1, wp.length)).toFixed(3)}%)`)
  }

  fs.writeFileSync(OUT_JSON, JSON.stringify({
    faces: faces.length, labeled: labeled.length,
    same: same.length, diff: diff.length, withinPhotoDiff: withinPhotoDiff.length,
    sameCross: sameCross.map((p) => ({ sim: p.sim, label: p.label, sideA: p.a.side, sideB: p.b.side })),
    diffCross: diffCross.map((p) => ({ sim: p.sim, sideA: p.a.side, sideB: p.b.side })),
    withinPhotoDiffSims: wp,
    results,
  }, null, 2))
  console.log(`\nJSON: ${OUT_JSON}`)

  store.close()
  try { fs.rmSync(dbPath, { force: true }) } catch {}
}

main().catch((e) => { console.error(e); process.exit(1) })