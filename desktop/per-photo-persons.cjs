#!/usr/bin/env node
/**
 * Per-photo person count: OLD (live DB clustering) vs NEW (true-HAC).
 * Uses node:sqlite so it runs on plain node. Does NOT mutate the live DB.
 */
const path = require('path')
const os = require('os')
const fs = require('fs')
const { DatabaseSync } = require('node:sqlite')

const dbPath = path.join(os.homedir(), 'Library/Application Support/Picly/data/picly.db')
const db = new DatabaseSync(dbPath, { readOnly: true })

const faces = db.prepare(`
  SELECT f.id AS faceId, f.photo_id AS photoId, f.person_id AS personId,
         f.embedding, p.path AS photoPath
  FROM faces f JOIN photos p ON p.id = f.photo_id
`).all()
console.log(`DB: ${dbPath}`)
console.log(`faces: ${faces.length} | photos: ${new Set(faces.map((f) => f.photoId)).size}\n`)

function blobToEmbedding(b) {
  const buf = b instanceof Uint8Array ? Buffer.from(b) : b
  return Float32Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4))
}
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
const emb = faces.map((f) => blobToEmbedding(f.embedding))
const n = emb.length
const THRESHOLD = 0.45

// ---- OLD: as stored in live DB ----
function oldPerPhoto() {
  const per = new Map()
  for (const f of faces) {
    if (!f.personId) continue
    const k = f.photoId
    if (!per.has(k)) per.set(k, new Set())
    per.get(k).add(f.personId)
  }
  return per
}

// ---- NEW: true-HAC (same as store.ts) ----
function newHAC() {
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
  const centroid = emb.map((e) => Float32Array.from(e))
  const size = new Array(n).fill(1)
  const sims = new Float32Array(n * n)
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const s = cosine(emb[i], emb[j]); sims[i * n + j] = s; sims[j * n + i] = s
  }
  for (;;) {
    let bestI = -1, bestJ = -1, bestS = THRESHOLD
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
  const rootOf = new Map()
  for (let i = 0; i < n; i++) {
    const r = find(i)
    if (!rootOf.has(r)) rootOf.set(r, rootOf.size)
  }
  return faces.map((f, i) => ({ faceId: f.faceId, photoId: f.photoId, person: rootOf.get(find(i)) }))
}

const oldPer = oldPerPhoto()
const newRows = newHAC()
const newPer = new Map()
for (const r of newRows) {
  if (!newPer.has(r.photoId)) newPer.set(r.photoId, new Set())
  newPer.get(r.photoId).add(r.person)
}

// photo name + face count + distinct persons old vs new
const photoName = new Map()
for (const f of faces) photoName.set(f.photoId, f.photoPath.split('/').pop())
const photoIds = [...new Set(faces.map((f) => f.photoId))].sort()
console.log('photo               faces | persons OLD -> NEW')
let sumOld = 0, sumNew = 0, rows = 0
for (const pid of photoIds) {
  const fc = faces.filter((f) => f.photoId === pid).length
  const o = oldPer.get(pid)?.size ?? 0
  const nn = newPer.get(pid)?.size ?? 0
  sumOld += o; sumNew += nn; rows++
  console.log(`${(photoName.get(pid) || pid).padEnd(20)} ${String(fc).padStart(4)} | ${String(o).padStart(3)} -> ${String(nn).padStart(3)}`)
}
console.log(`\nTOTAL distinct person-photo pairs: OLD=${sumOld}  NEW=${sumNew}`)
console.log(`Avg persons/photo: OLD=${(sumOld / rows).toFixed(1)}  NEW=${(sumNew / rows).toFixed(1)}`)

db.close()
