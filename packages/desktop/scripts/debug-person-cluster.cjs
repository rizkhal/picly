#!/usr/bin/env node
/**
 * Replay BOTH clustering algorithms on one person's faces:
 *  - OLD: greedy single-pass centroid-linkage (store.ts before this change)
 *  - NEW: true average-linkage HAC with centroid recompute (store.ts now)
 *
 * Usage: node debug-person-cluster.cjs <personName> [threshold]
 */
const path = require('path')
const os = require('os')
const fs = require('fs')
const { DatabaseSync } = require('node:sqlite')

const personName = process.argv[2] || 'Person 33'
const threshold = parseFloat(process.argv[3] || '0.45')

const candidates = [
  path.join(os.homedir(), 'Library/Application Support/Picly/data/picly.db'),
  path.join(os.homedir(), 'Library/Application Support/picly-desktop/data/picly.db'),
]
const dbPath = candidates.find((p) => fs.existsSync(p))
if (!dbPath) { console.error('No picly.db found'); process.exit(1) }

const db = new DatabaseSync(dbPath, { readOnly: true })
const faces = db.prepare(`
  SELECT f.id AS faceId, f.photo_id AS photoId, f.x1, f.y1, f.x2, f.y2,
         f.face_quality AS faceQuality, f.embedding, p.path AS photoPath
  FROM faces f JOIN persons p2 ON p2.id = f.person_id
  JOIN photos p ON p.id = f.photo_id
  WHERE p2.name = ?
`).all(personName)
if (faces.length === 0) { console.error(`No faces for ${personName}`); process.exit(1) }
console.log(`DB: ${dbPath}\nTarget: ${personName} — ${faces.length} faces (threshold ${threshold})`)

function blobToEmbedding(b) {
  const buf = b instanceof Uint8Array ? Buffer.from(b) : b
  const f = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  return Float32Array.from(f)
}
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
function shortName(p, i) { return `${p.split('/').pop()}#${i}` }

const emb = faces.map((f) => blobToEmbedding(f.embedding))
const n = emb.length

// ---------------- OLD: greedy single-pass centroid linkage ----------------
function oldCluster(threshold) {
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
  const centroid = emb.map((e) => Float32Array.from(e))
  const size = new Array(n).fill(1)
  const sims = []
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) sims.push({ a: i, b: j, s: cosine(emb[i], emb[j]) })
  sims.sort((x, y) => y.s - x.s)
  for (const { a, b, s } of sims) {
    if (s < threshold) break
    const ra = find(a); const rb = find(b)
    if (ra === rb) continue
    const sa = cosine(centroid[ra], centroid[rb])
    if (sa < threshold) continue
    const [big, small] = size[ra] >= size[rb] ? [ra, rb] : [rb, ra]
    parent[small] = big
    const out = new Float32Array(512)
    for (let k = 0; k < 512; k++) out[k] = (centroid[big][k] * size[big] + centroid[small][k] * size[small]) / (size[big] + size[small])
    centroid[big] = out; size[big] += size[small]
  }
  const roots = new Set()
  for (let i = 0; i < n; i++) roots.add(find(i))
  return roots.size
}

// ---------------- NEW: true average-linkage HAC (recompute centroid) ----------------
function newCluster(threshold, logMerges = false) {
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
  const centroid = emb.map((e) => Float32Array.from(e))
  const size = new Array(n).fill(1)
  // Pairwise sim matrix (symmetric)
  const sims = new Float32Array(n * n)
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const s = cosine(emb[i], emb[j]); sims[i * n + j] = s; sims[j * n + i] = s
  }
  let merges = 0
  for (;;) {
    let bestI = -1, bestJ = -1, bestS = threshold
    for (let i = 0; i < n; i++) {
      const ri = find(i)
      for (let j = i + 1; j < n; j++) {
        const rj = find(j)
        if (rj === ri) continue
        const s = sims[ri * n + rj]
        if (s > bestS) { bestS = s; bestI = ri; bestJ = rj }
      }
    }
    if (bestI < 0) break
    if (size[bestI] >= size[bestJ]) {
      // merge bestJ into bestI
      parent[bestJ] = bestI
      const out = new Float32Array(512)
      for (let k = 0; k < 512; k++) out[k] = (centroid[bestI][k] * size[bestI] + centroid[bestJ][k] * size[bestJ]) / (size[bestI] + size[bestJ])
      let norm = 0; for (let k = 0; k < 512; k++) norm += out[k] * out[k]
      norm = Math.sqrt(norm)
      if (norm > 0) for (let k = 0; k < 512; k++) out[k] /= norm
      centroid[bestI] = out; size[bestI] += size[bestJ]
      if (logMerges) {
        merges++
        console.log(`merge #${merges}: centroidSim=${bestS.toFixed(3)} sizeA=${size[bestJ]} sizeB=${size[bestI] - size[bestJ]} -> size=${size[bestI]}`)
      }
    } else {
      parent[bestI] = bestJ
      const out = new Float32Array(512)
      for (let k = 0; k < 512; k++) out[k] = (centroid[bestJ][k] * size[bestJ] + centroid[bestI][k] * size[bestI]) / (size[bestJ] + size[bestI])
      let norm = 0; for (let k = 0; k < 512; k++) norm += out[k] * out[k]
      norm = Math.sqrt(norm)
      if (norm > 0) for (let k = 0; k < 512; k++) out[k] /= norm
      centroid[bestJ] = out; size[bestJ] += size[bestI]
      if (logMerges) {
        merges++
        console.log(`merge #${merges}: centroidSim=${bestS.toFixed(3)} sizeA=${size[bestI]} sizeB=${size[bestJ] - size[bestI]} -> size=${size[bestJ]}`)
      }
    }
  }
  const roots = new Set()
  for (let i = 0; i < n; i++) roots.add(find(i))
  return roots.size
}

for (const t of [0.45, 0.5, 0.55, 0.6]) {
  const oldC = oldCluster(t)
  const newC = newCluster(t)
  console.log(`\nthreshold ${t}: OLD greedy = ${oldC} clusters | NEW true-HAC = ${newC} clusters`)
}

console.log('\n=== NEW true-HAC merge log (threshold 0.45) ===')
newCluster(0.45, true)

db.close()
