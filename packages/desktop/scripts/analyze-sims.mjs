/**
 * Measure clustering quality on the scanned LFW faces.
 *
 * 1) Cosine-sim distribution of POSITIVE pairs (same ground-truth person)
 *    vs NEGATIVE pairs (different person), using the LFW folder name as label.
 * 2) Replay the incremental centroid clustering (same algorithm as store.ts
 *    clusterFace) per ground-truth person, at several thresholds, and count
 *    how many clusters (="persons") one real person gets split into.
 *
 * Usage: node scripts/analyze-sims.mjs [dbPath]
 */
import Database from 'better-sqlite3'

const dbPath = process.argv[2] ?? '/Users/rizkal/Library/Application Support/picly-desktop/data/picly.db'
const db = new Database(dbPath, { readonly: true })

function blobToEmbedding(buf) {
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom > 0 ? dot / denom : 0
}

// Ground-truth label: the folder right under lfw_funneled/
function gtLabel(p) {
  const m = String(p).match(/lfw_funneled\/([^/]+)\//)
  return m ? m[1] : null
}

const rows = db.prepare(`
  SELECT f.embedding, p.path
  FROM faces f JOIN photos p ON p.id = f.photo_id
`).all()

const labeled = rows
  .map((r) => ({ emb: blobToEmbedding(r.embedding), label: gtLabel(r.path) }))
  .filter((r) => r.label)

console.log(`faces total: ${rows.length}`)
console.log(`labeled (LFW): ${labeled.length}`)

const byLabel = new Map()
for (const r of labeled) {
  if (!byLabel.has(r.label)) byLabel.set(r.label, [])
  byLabel.get(r.label).push(r)
}
const multi = [...byLabel.entries()].filter(([, fs]) => fs.length >= 2)
console.log(`distinct persons: ${byLabel.size}, with >=2 faces: ${multi.length}`)

// ---- 1) pairwise sim distributions (sampled, capped) ----------------------
const pos = []
const neg = []
const MAX_POS = 3000
const MAX_NEG = 3000

for (const [label, faces] of multi) {
  for (let i = 0; i < faces.length && pos.length < MAX_POS; i++) {
    for (let j = i + 1; j < faces.length && pos.length < MAX_POS; j++) {
      pos.push(cosine(faces[i].emb, faces[j].emb))
    }
  }
}

// negative pairs: sample a few per label vs a few random other labels
outer: for (let a = 0; a < multi.length && neg.length < MAX_NEG; a++) {
  const [la, facesA] = multi[a]
  for (let b = a + 1; b < multi.length && neg.length < MAX_NEG; b++) {
    const [lb, facesB] = multi[b]
    for (let i = 0; i < Math.min(3, facesA.length) && neg.length < MAX_NEG; i++) {
      for (let j = 0; j < Math.min(3, facesB.length) && neg.length < MAX_NEG; j++) {
        neg.push(cosine(facesA[i].emb, facesB[j].emb))
      }
    }
  }
}

function stats(name, arr) {
  const s = arr.slice().sort((x, y) => x - y)
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]
  const fmt = (v) => v.toFixed(3)
  console.log(
    `${name.padEnd(10)} n=${String(s.length).padStart(5)}  min=${fmt(s[0])}  p5=${fmt(q(0.05))}  p25=${fmt(q(0.25))}  med=${fmt(q(0.5))}  p75=${fmt(q(0.75))}  p95=${fmt(q(0.95))}  max=${fmt(s[s.length - 1])}`
  )
}
console.log('\n--- pairwise cosine similarity ---')
stats('positive', pos)
stats('negative', neg)

// ---- 2) replay incremental centroid clustering per threshold ---------------
console.log('\n--- replay: clusters per ground-truth person (incremental centroid) ---')
const THRESHOLDS = [0.65, 0.6, 0.55, 0.5, 0.45, 0.4]

for (const t of THRESHOLDS) {
  let totalClusters = 0
  let totalPersons = 0
  let personsSplit = 0
  let maxSplit = 0
  for (const [label, faces] of byLabel) {
    if (faces.length < 2) continue
    // clusters: running-average centroid, same update rule as store.clusterFace
    const centroids = []
    for (const f of faces) {
      let best = -1
      let bestSim = t
      for (let c = 0; c < centroids.length; c++) {
        const sim = cosine(f.emb, centroids[c])
        if (sim > bestSim) { bestSim = sim; best = c }
      }
      if (best >= 0) {
        const old = centroids[best]
        const next = new Float32Array(512)
        for (let i = 0; i < 512; i++) next[i] = (old[i] + f.emb[i]) / 2
        centroids[best] = next
      } else {
        centroids.push(new Float32Array(f.emb))
      }
    }
    totalClusters += centroids.length
    totalPersons += 1
    if (centroids.length > 1) { personsSplit += 1; maxSplit = Math.max(maxSplit, centroids.length) }
  }
  const avg = (totalClusters / totalPersons).toFixed(2)
  console.log(
    `thr=${t.toFixed(2)}  clusters/person=${avg}  total=${totalClusters}  persons=${totalPersons}  split_persons=${personsSplit} (${((personsSplit / totalPersons) * 100).toFixed(1)}%)  max_clusters_one_person=${maxSplit}`
  )
}
