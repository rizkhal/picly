#!/usr/bin/env node
/**
 * Compare OLD greedy vs NEW true-HAC clustering across the ENTIRE database.
 * Reports cluster-size distribution + the biggest clusters for each.
 *
 * Usage: node compare-clustering.cjs [threshold]
 */
const path = require('path')
const os = require('os')
const fs = require('fs')
const { DatabaseSync } = require('node:sqlite')

const threshold = parseFloat(process.argv[2] || '0.45')
const candidates = [
  path.join(os.homedir(), 'Library/Application Support/Picly/data/picly.db'),
  path.join(os.homedir(), 'Library/Application Support/picly-desktop/data/picly.db'),
]
const dbPath = candidates.find((p) => fs.existsSync(p))
if (!dbPath) { console.error('No picly.db found'); process.exit(1) }
console.log(`DB: ${dbPath}  (threshold ${threshold})\n`)

const db = new DatabaseSync(dbPath, { readOnly: true })
const faces = db.prepare(`
  SELECT f.id AS faceId, f.photo_id AS photoId, f.face_quality AS faceQuality,
         f.embedding, p.path AS photoPath
  FROM faces f JOIN photos p ON p.id = f.photo_id
`).all()
console.log(`Total faces: ${faces.length}`)

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

const emb = faces.map((f) => blobToEmbedding(f.embedding))
const n = emb.length

function cluster(trueHac) {
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
  const centroid = emb.map((e) => Float32Array.from(e))
  const size = new Array(n).fill(1)
  const sims = new Float32Array(n * n)
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const s = cosine(emb[i], emb[j]); sims[i * n + j] = s; sims[j * n + i] = s
  }
  if (trueHac) {
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
        parent[bestJ] = bestI
        const out = new Float32Array(512)
        for (let k = 0; k < 512; k++) out[k] = (centroid[bestI][k] * size[bestI] + centroid[bestJ][k] * size[bestJ]) / (size[bestI] + size[bestJ])
        let norm = 0; for (let k = 0; k < 512; k++) norm += out[k] * out[k]
        norm = Math.sqrt(norm); if (norm > 0) for (let k = 0; k < 512; k++) out[k] /= norm
        centroid[bestI] = out; size[bestI] += size[bestJ]
      } else {
        parent[bestI] = bestJ
        const out = new Float32Array(512)
        for (let k = 0; k < 512; k++) out[k] = (centroid[bestJ][k] * size[bestJ] + centroid[bestI][k] * size[bestI]) / (size[bestJ] + size[bestI])
        let norm = 0; for (let k = 0; k < 512; k++) norm += out[k] * out[k]
        norm = Math.sqrt(norm); if (norm > 0) for (let k = 0; k < 512; k++) out[k] /= norm
        centroid[bestJ] = out; size[bestJ] += size[bestI]
      }
    }
  } else {
    const pairs = []
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push({ a: i, b: j, s: cosine(emb[i], emb[j]) })
    pairs.sort((x, y) => y.s - x.s)
    for (const { a, b, s } of pairs) {
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
  }
  // Collect clusters with member counts
  const clusters = new Map()
  for (let i = 0; i < n; i++) {
    const r = find(i)
    clusters.set(r, (clusters.get(r) || 0) + 1)
  }
  return clusters
}

function report(name, clusters) {
  const sizes = Array.from(clusters.values())
  sizes.sort((a, b) => b - a)
  const big = sizes.filter((s) => s >= 5).length
  const singletons = sizes.filter((s) => s === 1).length
  const totalClusters = sizes.length
  console.log(`\n=== ${name} ===`)
  console.log(`clusters: ${totalClusters} | singletons: ${singletons} | clusters >=5 members: ${big}`)
  console.log(`top sizes: ${sizes.slice(0, 10).join(', ')}`)
}

const oldC = cluster(false)
const newC = cluster(true)
report('OLD greedy centroid-linkage', oldC)
report('NEW true-HAC (recompute)', newC)

// Per-photo face count — how many distinct people per photo would each produce?
const photoFaces = new Map()
for (const f of faces) photoFaces.set(f.photoId, (photoFaces.get(f.photoId) || 0) + 1)
console.log(`\nPhotos: ${photoFaces.size} | avg faces/photo: ${(n / photoFaces.size).toFixed(1)}`)

db.close()
