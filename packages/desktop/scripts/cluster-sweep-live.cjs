#!/usr/bin/env node
/**
 * Threshold sweep on the LIVE DB (already-scanned faces). Reads all faces +
 * embeddings, runs the HAC clusterer at multiple thresholds + QA modes, and
 * reports cluster count / singletons / quality tier distribution / person sizes.
 * Fast (no scan) — just replay clustering on existing embeddings.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/cluster-sweep-live.cjs
 */
const path = require('node:path')
const os = require('node:os')
const { PhotoStore } = require('../dist-main/db/store.js')

const db = require('better-sqlite3')(path.join(os.homedir(), 'Library/Application Support/Picly/data/picly.db'), { readonly: true })
const faces = db.prepare(`SELECT id, face_quality AS q, embedding FROM faces WHERE embedding IS NOT NULL`).all()

const blobToEmb = (b) => new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)
const cosine = (a, b) => {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
const data = faces.map((f) => ({ id: f.id, q: f.q, emb: blobToEmb(f.embedding) }))
const n = data.length
console.log(`live faces (with embedding): ${n}`)

// ---- HAC (replicated from store.ts, with QA gate) ----
function runHAC(threshold, opts = {}) {
  const { lowJoinSim = 0.6, qa = false } = opts
  const m = n
  const parent = Array.from({ length: m }, (_, i) => i)
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
  const centroid = data.map((f) => Float32Array.from(f.emb))
  const size = new Array(m).fill(1)
  const low = data.map((f) => f.q === 'low' || f.q === 'very_low')
  const canJoin = (ia, ib, s) => {
    const aLow = low[ia], bLow = low[ib]
    if (aLow && !bLow) return s >= lowJoinSim
    if (bLow && !aLow) return s >= lowJoinSim
    if (aLow && bLow) return false
    return true
  }
  // pairwise sims
  const sims = new Float32Array(m * m)
  for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) {
    const s = cosine(data[i].emb, data[j].emb)
    sims[i * m + j] = s; sims[j * m + i] = s
  }
  for (;;) {
    let bestI = -1, bestJ = -1, bestS = threshold
    for (let i = 0; i < m; i++) {
      const ri = find(i)
      for (let j = i + 1; j < m; j++) {
        const rj = find(j)
        if (rj === ri) continue
        const s = sims[ri * m + rj]
        if (s > bestS) { bestS = s; bestI = ri; bestJ = rj }
      }
    }
    if (bestI < 0) break
    const lowI = low[bestI]
    const lowJ = low[bestJ]
    if (qa) {
      const needGate = (size[bestI] === 1 && size[bestJ] === 1) || lowI || lowJ
      if (needGate && !canJoin(bestI, bestJ, bestS)) {
        sims[bestI * m + bestJ] = threshold
        sims[bestJ * m + bestI] = threshold
        continue
      }
    }
    if (size[bestI] >= size[bestJ]) {
      parent[bestJ] = bestI
      const cy = centroid[bestI], cx = centroid[bestJ]
      const ny = size[bestI], nx = size[bestJ]
      const out = new Float32Array(512)
      for (let k = 0; k < 512; k++) out[k] = (cy[k] * ny + cx[k] * nx) / (ny + nx)
      let norm = 0; for (let k = 0; k < 512; k++) norm += out[k] * out[k]
      norm = Math.sqrt(norm); if (norm > 0) for (let k = 0; k < 512; k++) out[k] /= norm
      centroid[bestI] = out; size[bestI] += nx
      if (qa) low[bestI] = lowI || lowJ
    } else {
      parent[bestI] = bestJ
      const cy = centroid[bestJ], cx = centroid[bestI]
      const ny = size[bestJ], nx = size[bestI]
      const out = new Float32Array(512)
      for (let k = 0; k < 512; k++) out[k] = (cy[k] * ny + cx[k] * nx) / (ny + nx)
      let norm = 0; for (let k = 0; k < 512; k++) norm += out[k] * out[k]
      norm = Math.sqrt(norm); if (norm > 0) for (let k = 0; k < 512; k++) out[k] /= norm
      centroid[bestJ] = out; size[bestJ] += nx
      if (qa) low[bestJ] = lowI || lowJ
    }
  }
  const clusters = new Map()
  for (let i = 0; i < m; i++) {
    const r = find(i)
    if (!clusters.has(r)) clusters.set(r, [])
    clusters.get(r).push(i)
  }
  return [...clusters.values()]
}

// ---- Report per config ----
const configs = [
  { name: '0.45 global', threshold: 0.45, qa: false },
  { name: '0.50 global', threshold: 0.50, qa: false },
  { name: '0.55 global', threshold: 0.55, qa: false },
  { name: '0.60 global', threshold: 0.60, qa: false },
  { name: '0.55 QA', threshold: 0.55, qa: true },
  { name: '0.60 QA', threshold: 0.60, qa: true },
]
console.log('\nconfig          clusters  singletons  top5 sizes')
for (const c of configs) {
  const clusters = runHAC(c.threshold, { qa: c.qa })
  const sizes = clusters.map((cl) => cl.length).sort((a, b) => b - a)
  const singles = sizes.filter((s) => s === 1).length
  const top5 = sizes.slice(0, 5).join(',')
  console.log(`${c.name.padEnd(16)} ${String(clusters.length).padStart(5)}  ${String(singles).padStart(6)}      ${top5}`)
}
db.close()
