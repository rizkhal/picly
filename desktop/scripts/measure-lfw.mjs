/**
 * Measure embedding similarity distribution on real LFW photos using the local
 * ONNX pipeline directly (same FaceAnalysis as the app).
 *
 * For each of a handful of LFW identities (folder name = ground truth), run the
 * pipeline on several of their photos, then:
 *   1) pairwise cosSim same-person (positive) vs diff-person (negative)
 *   2) replay incremental centroid clustering at several thresholds to estimate
 *      how many "persons" one real person gets split into
 *
 * Usage: node --experimental-strip-types scripts/measure-lfw.mjs <lfwRoot>
 */
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { FaceAnalysis } from '../src/main/ml/index'

const root = process.argv[2]
if (!root) {
  console.error('usage: node scripts/measure-lfw.mjs <lfw_funneled dir>')
  process.exit(1)
}

const identities = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .slice(0, 40) // cap

const analysis = await FaceAnalysis.create()

/** Pick up to N photo files per identity. */
function samplePhotos(dir, n) {
  return readdirSync(dir)
    .filter((f) => /\.(jpe?g|png)$/i.test(f) && !f.startsWith('._'))
    .slice(0, n)
    .map((f) => path.join(dir, f))
}

const perPerson = []
for (const name of identities) {
  const photos = samplePhotos(path.join(root, name), 10)
  const embeddings = []
  for (const p of photos) {
    try {
      const faces = await analysis.detect(p)
      // take the largest face (bbox area) — most likely the subject
      if (faces.length === 0) continue
      faces.sort((a, b) => (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1]) - (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]))
      embeddings.push(faces[0].embedding)
    } catch (e) {
      console.error('  skip', p, e.message)
    }
  }
  if (embeddings.length >= 2) perPerson.push({ name, embeddings })
}

console.log(`identities with >=2 faces: ${perPerson.length}`)

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

const pos = []
const neg = []
for (const p of perPerson) {
  const es = p.embeddings
  for (let i = 0; i < es.length; i++) {
    for (let j = i + 1; j < es.length; j++) pos.push(cosine(es[i], es[j]))
  }
}
for (let a = 0; a < perPerson.length; a++) {
  for (let b = a + 1; b < perPerson.length; b++) {
    const ea = perPerson[a].embeddings
    const eb = perPerson[b].embeddings
    for (let i = 0; i < Math.min(3, ea.length); i++) {
      for (let j = 0; j < Math.min(3, eb.length); j++) neg.push(cosine(ea[i], eb[j]))
    }
  }
}

function stats(name, arr) {
  const s = arr.slice().sort((x, y) => x - y)
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]
  console.log(
    `${name.padEnd(9)} n=${String(s.length).padStart(5)}  p5=${q(0.05).toFixed(3)} p25=${q(0.25).toFixed(3)} med=${q(0.5).toFixed(3)} p75=${q(0.75).toFixed(3)} p95=${q(0.95).toFixed(3)} max=${s[s.length - 1].toFixed(3)}`
  )
}
console.log('\n--- pairwise cosine similarity ---')
stats('positive', pos)
stats('negative', neg)

// ---- replay clustering ----
console.log('\n--- replay: clusters per identity (incremental centroid) ---')
for (const t of [0.65, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3]) {
  let totalClusters = 0
  let split = 0
  let maxClusters = 0
  for (const p of perPerson) {
    const centroids = []
    for (const e of p.embeddings) {
      let best = -1
      let bestSim = t
      for (let c = 0; c < centroids.length; c++) {
        const sim = cosine(e, centroids[c])
        if (sim > bestSim) { bestSim = sim; best = c }
      }
      if (best >= 0) {
        const old = centroids[best]
        const next = new Float32Array(512)
        for (let i = 0; i < 512; i++) next[i] = (old[i] + e[i]) / 2
        centroids[best] = next
      } else {
        centroids.push(new Float32Array(e))
      }
    }
    totalClusters += centroids.length
    if (centroids.length > 1) split += 1
    maxClusters = Math.max(maxClusters, centroids.length)
  }
  console.log(
    `thr=${t.toFixed(2)}  clusters/person=${(totalClusters / perPerson.length).toFixed(2)}  split=${split}/${perPerson.length} (${((split / perPerson.length) * 100).toFixed(0)}%)  max_clusters=${maxClusters}`
  )
}
