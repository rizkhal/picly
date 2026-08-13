/**
 * Ground-truth validation of small-face re-embedding.
 *
 * Uses LFW (labeled identities) to measure whether re-embedding SMALL faces
 * from a padded crop raises same-identity similarity (and cross-identity stays
 * low). Also checks a cross-domain pair (news photo vs iPhone group photo).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/test-small-face-gt.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { decodeRgb, warpAffine, cropFace } = require('../dist-main/ml/image.js')
const { FaceAnalysis } = require('../dist-main/ml/faceAnalysis.js')
const { ARCFACE_DST } = require('../dist-main/ml/faceAnalysis.js')
const { umeyama } = require('../dist-main/ml/matrix.js')

const LFW_ROOT = '/Volumes/X/Dataset/lfw/lfw_funneled'
const LFW_FACES = 8 // faces per identity to embed

function cosine(a, b) {
  let d = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  const den = Math.sqrt(na) * Math.sqrt(nb)
  return den > 0 ? d / den : 0
}

async function main() {
  const analysis = await FaceAnalysis.create()
  const embedder = analysis.embedder

  // ---- Collect faces for a few identities (detected at 640, some small) ----
  const people = ['George_W_Bush', 'Colin_Powell', 'Tony_Blair', 'Gerhard_Schroeder', 'Hugo_Chavez', 'Ariel_Sharon']
  const ids = {} // identity -> array of {bbox, img, kps, rawFeat, smallFeat}
  for (const person of people) {
    const dir = path.join(LFW_ROOT, person)
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg') && !f.startsWith('.')).sort().slice(0, LFW_FACES)
    const list = []
    for (const f of files) {
      const img = await decodeRgb(path.join(dir, f))
      const faces = await analysis.detectFromImage(img)
      for (const face of faces) {
        const M = umeyama(face.kps, ARCFACE_DST)
        const aimg = warpAffine(img, M, 112)
        const rawFeat = embedder.l2Normalize(await embedder.getFeat(aimg))
        // re-embed from padded crop
        const crop = cropFace(img, face.bbox, 112, 0.2)
        const smallFeat = embedder.l2Normalize(await embedder.getFeat(crop))
        list.push({ bbox: face.bbox, img, kps: face.kps, rawFeat, smallFeat })
      }
    }
    ids[person] = list
    console.log(`${person}: ${list.length} faces`)
  }

  // ---- Same-identity intra sim: raw vs small-reembed ----
  console.log(`\n=== INTRA-IDENTITY (same person, all face pairs) ===`)
  for (const person of people) {
    const list = ids[person]
    if (list.length < 2) continue
    let rawSum = 0, smallSum = 0, n = 0
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        rawSum += cosine(list[i].rawFeat, list[j].rawFeat)
        smallSum += cosine(list[i].smallFeat, list[j].smallFeat)
        n++
      }
    }
    const rawMean = rawSum / n
    const smallMean = smallSum / n
    console.log(`  ${person.padEnd(18)} raw=${rawMean.toFixed(4)}  smallReembed=${smallMean.toFixed(4)}  ${smallMean > rawMean ? 'UP' : 'DOWN'}`)
  }

  // ---- Cross-identity inter sim (worst offenders) ----
  console.log(`\n=== INTER-IDENTITY (different people, mean) ===`)
  const cross = []
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const a = ids[people[i]]
      const b = ids[people[j]]
      let rawSum = 0, smallSum = 0, n = 0
      for (const x of a) for (const y of b) { rawSum += cosine(x.rawFeat, y.rawFeat); smallSum += cosine(x.smallFeat, y.smallFeat); n++ }
      cross.push({ p: `${people[i]}/${people[j]}`, raw: rawSum / n, small: smallSum / n })
    }
  }
  cross.sort((x, y) => y.small - x.small)
  for (const c of cross.slice(0, 8)) {
    console.log(`  ${c.p.padEnd(32)} raw=${c.raw.toFixed(4)}  small=${c.small.toFixed(4)}`)
  }

  // ---- Cross-domain: news vs iPhone (the 281/293 case) ----
  console.log(`\n=== CROSS-DOMAIN (news person vs iPhone group person) ===`)
  // We don't know the true identity mapping; just report raw vs small for the
  // closest pair we found earlier (Person 2/26).
  // For now: detect on a news photo + an iPhone photo, print face sims.
  const news = await decodeRgb('/Volumes/X/Dataset/psdkp/images.jpg')
  const iphone = await decodeRgb('/Volumes/X/Dataset/psdkp/2026_08_08_08_23_IMG_0594.JPG')
  const newsFaces = await analysis.detectFromImage(news)
  const iphoneFaces = await analysis.detectFromImage(iphone)
  console.log(`news faces: ${newsFaces.length}, iphone faces: ${iphoneFaces.length}`)
  // Compare each news face to each iphone face, raw vs small
  let bestRaw = 0, bestSmall = 0
  for (const nf of newsFaces) {
    const nM = umeyama(nf.kps, ARCFACE_DST)
    const nAimg = warpAffine(news, nM, 112)
    const nRaw = embedder.l2Normalize(await embedder.getFeat(nAimg))
    const nCrop = cropFace(news, nf.bbox, 112, 0.2)
    const nSmall = embedder.l2Normalize(await embedder.getFeat(nCrop))
    for (const pf of iphoneFaces) {
      const pM = umeyama(pf.kps, ARCFACE_DST)
      const pAimg = warpAffine(iphone, pM, 112)
      const pRaw = embedder.l2Normalize(await embedder.getFeat(pAimg))
      const pCrop = cropFace(iphone, pf.bbox, 112, 0.2)
      const pSmall = embedder.l2Normalize(await embedder.getFeat(pCrop))
      const r = cosine(nRaw, pRaw)
      const s = cosine(nSmall, pSmall)
      if (r > bestRaw) bestRaw = r
      if (s > bestSmall) bestSmall = s
    }
  }
  console.log(`  best news<->iphone: raw=${bestRaw.toFixed(4)}  smallReembed=${bestSmall.toFixed(4)}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
