#!/usr/bin/env node
/** Compare clusters at 0.45 vs 0.50: which clusters split, and are they junk or real? */
const path = require('node:path')
const os = require('node:os')
const { PhotoStore } = require('../dist-main/db/store.js')
const db = require('better-sqlite3')(path.join(os.homedir(), 'Library/Application Support/Picly/data/picly.db'), { readonly: true })

const faces = db.prepare(`SELECT id, photo_id, embedding, face_quality q, quality_score qs FROM faces WHERE embedding IS NOT NULL`).all()
const blobToEmb = (b) => new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)
const cosine = (a, b) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] } return d / (Math.sqrt(na) * Math.sqrt(nb)) }
const data = faces.map((f) => ({ id: f.id, ph: f.photo_id, q: f.q, qs: f.qs, emb: blobToEmb(f.embedding) }))
const n = data.length

function runHAC(threshold) {
  const m = n
  const parent = Array.from({ length: m }, (_, i) => i)
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
  const centroid = data.map((f) => Float32Array.from(f.emb))
  const size = new Array(m).fill(1)
  const low = data.map((f) => f.q === 'low' || f.q === 'very_low')
  const canJoin = (ia, ib, s) => {
    const aL = low[ia], bL = low[ib]
    if (aL && !bL) return s >= 0.6
    if (bL && !aL) return s >= 0.6
    if (aL && bL) return false
    return true
  }
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
    const lowI = low[bestI], lowJ = low[bestJ]
    const needGate = (size[bestI] === 1 && size[bestJ] === 1) || lowI || lowJ
    if (needGate && !canJoin(bestI, bestJ, bestS)) {
      sims[bestI * m + bestJ] = threshold
      sims[bestJ * m + bestI] = threshold
      continue
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
      if (lowI || lowJ) low[bestI] = true
    } else {
      parent[bestI] = bestJ
      const cy = centroid[bestJ], cx = centroid[bestI]
      const ny = size[bestJ], nx = size[bestI]
      const out = new Float32Array(512)
      for (let k = 0; k < 512; k++) out[k] = (cy[k] * ny + cx[k] * nx) / (ny + nx)
      let norm = 0; for (let k = 0; k < 512; k++) norm += out[k] * out[k]
      norm = Math.sqrt(norm); if (norm > 0) for (let k = 0; k < 512; k++) out[k] /= norm
      centroid[bestJ] = out; size[bestJ] += nx
      if (lowI || lowJ) low[bestJ] = true
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

const c45 = runHAC(0.45)
const c50 = runHAC(0.50)

// Map faces to clusters at each threshold
const assign = (clusters) => {
  const m = new Map()
  clusters.forEach((members, ci) => members.forEach((fi) => m.set(data[fi].id, ci)))
  return m
}
const a45 = assign(c45)
const a50 = assign(c50)

// Faces that changed cluster assignment
const changed = new Set()
for (const f of data) if (a45.get(f.id) !== a50.get(f.id)) changed.add(f.id)

// Which clusters at 0.45 split or shrank at 0.50
console.log('clusters at 0.45:', c45.length, '| at 0.50:', c50.length)
console.log('faces that changed assignment:', changed.size)

// For each cluster at 0.45, see how many member faces survive together at 0.50
console.log('\nclusters at 0.45 that split (multi-face at 0.45 -> smaller at 0.50):')
const c45multi = c45.filter((c) => c.length >= 2).sort((a, b) => b.length - a.length)
for (const c of c45multi) {
  const ids = c.map((fi) => data[fi].id)
  const members = c.map((fi) => data[fi])
  // how many still in same 0.50 cluster?
  const same50 = new Set()
  for (const id of ids) same50.add(a50.get(id))
  const qs = members.map((f) => f.qs.toFixed(2)).join(',')
  const photos = new Set(members.map((f) => f.ph)).size
  if (same50.size > 1) {
    console.log(`  cluster ${ids.length} faces (avgQ=${(members.reduce((s, f) => s + f.qs, 0) / members.length).toFixed(3)}, photos=${photos}): splits into ${same50.size} at 0.50 [qs: ${qs}]`)
  }
}

// Which Person 37 faces
const p37ids = db.prepare(`SELECT f.id FROM faces f JOIN persons p ON p.id=f.person_id WHERE p.name='Person 37'`).all().map((r) => r.id)
console.log('\nPerson 37 faces cluster together at 0.45?', a45.get(p37ids[0]) === a45.get(p37ids[1]) ? 'YES' : 'no')
console.log('Person 37 faces cluster together at 0.50?', a50.get(p37ids[0]) === a50.get(p37ids[1]) ? 'YES' : 'no')

db.close()
