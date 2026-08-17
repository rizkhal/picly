#!/usr/bin/env node
/** Compare landmark geometry: junk Person-37 crops vs real faces of similar size. */
const path = require('node:path')
const os = require('node:os')
const { PhotoStore } = require('../dist-main/db/store.js')
const { FaceAnalysis } = require('../dist-main/ml/faceAnalysis.js')
const { decodeRgb } = require('../dist-main/ml/image.js')

const MODELS_DIR = process.env.PICLY_MODELS_DIR || path.join(__dirname, '..', 'models')
process.env.PICLY_MODELS_DIR = MODELS_DIR

const store = PhotoStore.open(path.join(os.homedir(), 'Library/Application Support/Picly/data/picly.db'))

const geom = (bbox, kps) => {
  const [x1, y1, x2, y2] = bbox
  const bw = x2 - x1, bh = y2 - y1
  const eyeL = kps[0], eyeR = kps[1], nose = kps[2], mouthL = kps[3], mouthR = kps[4]
  const eyeDist = Math.hypot(eyeL[0] - eyeR[0], eyeL[1] - eyeR[1])
  // midpoint of eyes, midpoint of mouth
  const eyeMid = [(eyeL[0] + eyeR[0]) / 2, (eyeL[1] + eyeR[1]) / 2]
  const mouthMid = [(mouthL[0] + mouthR[0]) / 2, (mouthL[1] + mouthR[1]) / 2]
  return {
    size: Math.round(Math.max(bw, bh)),
    eyeDist: +(eyeDist / Math.max(1, bw)).toFixed(3),
    // nose below eye line?
    noseBelowEye: +(nose[1] - eyeMid[1]).toFixed(1),
    // mouth below nose?
    mouthBelowNose: +(mouthMid[1] - nose[1]).toFixed(1),
    // vertical span eye->mouth as fraction of bh
    eyeMouthSpan: +((mouthMid[1] - eyeMid[1]) / Math.max(1, bh)).toFixed(3),
  }
}

async function main() {
  const analysis = await FaceAnalysis.create({ embed: false })

  // 1. Person 37 junk faces
  const p37 = store.db.prepare(`SELECT f.x1,f.y1,f.x2,f.y2,ph.path FROM faces f JOIN persons p ON p.id=f.person_id JOIN photos ph ON ph.id=f.photo_id WHERE p.name='Person 37'`).all()
  console.log('=== Person 37 (junk) ===')
  for (const f of p37) {
    const img = await decodeRgb(f.path)
    const dets = await analysis.detectFromImage(img)
    const face = dets.find(d => Math.abs(d.bbox[0] - f.x1) < 10 && Math.abs(d.bbox[1] - f.y1) < 10)
    if (face) console.log(' ', path.basename(f.path), geom(face.bbox, face.kps), 'detScore=' + face.detScore.toFixed(2))
    else console.log(' ', path.basename(f.path), 'NOT re-detected')
  }

  // 2. Real faces 50-75px from a few photos
  const real = []
  const dir = '/Volumes/X/Dataset/psdkp-sample-tile'
  const fs = require('node:fs')
  const files = fs.readdirSync(dir).filter(f => /\.JPG$/i.test(f) && !f.startsWith('._')).sort().slice(0, 8)
  for (const fn of files) {
    const img = await decodeRgb(path.join(dir, fn))
    const dets = await analysis.detectFromImage(img)
    for (const d of dets) {
      const size = Math.max(d.bbox[2] - d.bbox[0], d.bbox[3] - d.bbox[1])
      if (size >= 50 && size <= 75) real.push({ file: fn, ...geom(d.bbox, d.kps), detScore: d.detScore })
    }
  }
  console.log('\n=== Real faces 50-75px (sample ' + real.length + ') ===')
  for (const r of real.slice(0, 12)) console.log(' ', r.file, 'size=' + r.size, 'eyeDist=' + r.eyeDist, 'noseBelow=' + r.noseBelowEye, 'mouthBelowNose=' + r.mouthBelowNose, 'span=' + r.eyeMouthSpan, 'det=' + r.detScore.toFixed(2))

  store.close()
}
main().catch(e => { console.error(e); process.exit(1) })
