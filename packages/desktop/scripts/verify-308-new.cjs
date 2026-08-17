#!/usr/bin/env node
/**
 * Honest verification of the Person-308 fix with the NEW detection pipeline:
 * re-detect both photos, check the new quality of the DB-matching faces, compute
 * the embedding sim, and apply the cluster rule (LOW faces need sim >= 0.6 to
 * join; high/medium anchor at 0.45).
 *
 * Usage:
 *   cd desktop && node scripts/prepare-native.mjs electron && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/verify-308-new.cjs
 */
const path = require('node:path')
const os = require('node:os')
const { FaceAnalysis } = require('../dist-main/ml/faceAnalysis.js')
const { decodeRgb } = require('../dist-main/ml/image.js')
const { PhotoStore } = require('../dist-main/db/store.js')

const MODELS_DIR = process.env.PICLY_MODELS_DIR || path.join(__dirname, '..', 'models')
process.env.PICLY_MODELS_DIR = MODELS_DIR

const store = PhotoStore.open(path.join(os.homedir(), 'Library/Application Support/Picly/data/picly.db'))
const db = store.db

const LOW_JOIN_SIM = 0.6
const CLUSTER_THRESHOLD = 0.45

function cosine(a, b) {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

function near(a, bbox) {
  const ca = [(a[0] + a[2]) / 2, (a[1] + a[3]) / 2]
  const cb = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
  return Math.hypot(ca[0] - cb[0], ca[1] - cb[1]) < 80
}

async function detectPhoto(analysis, photoPath) {
  const img = await decodeRgb(photoPath)
  const dets = await analysis.detectFromImage(img)
  return dets
}

async function main() {
  const analysis = await FaceAnalysis.create({ embed: true })

  const A_PATH = '/Volumes/X/Dataset/psdkp/DSC02286.JPG'
  const B_PATH = '/Volumes/X/Dataset/psdkp/DSC02490.JPG'

  const dbRows = db
    .prepare(`SELECT f.id, f.person_id, f.face_quality, f.x1,f.y1,f.x2,f.y2, ph.path
              FROM faces f JOIN photos ph ON ph.id=f.photo_id
              WHERE ph.path IN (?, ?)`)
    .all(A_PATH, B_PATH)

  const detsA = await detectPhoto(analysis, A_PATH)
  const detsB = await detectPhoto(analysis, B_PATH)

  console.log('=== DB rows vs new pipeline ===')
  for (const r of dbRows) {
    const photo = r.path === A_PATH ? A_PATH : B_PATH
    const dets = r.path === A_PATH ? detsA : detsB
    const det = dets.find((d) => near(d.bbox, [r.x1, r.y1, r.x2, r.y2]))
    if (det) {
      console.log(`  ${r.id.slice(0, 8)} stored q=${r.face_quality} -> NEW q=${det.quality} (size=${Math.round(Math.max(det.bbox[2] - det.bbox[0], det.bbox[3] - det.bbox[1]))}, score=${det.detScore.toFixed(3)}, yaw=${det.facePose.yawRatio.toFixed(2)})`)
    } else {
      console.log(`  ${r.id.slice(0, 8)} stored q=${r.face_quality} -> NOT re-detected (bbox moved)`)
    }
  }

  // Pair: the two false-merge faces (by old person f484ef15)
  const aRow = dbRows.find((r) => r.path === A_PATH && r.x1 > 4800)
  const bRow = dbRows.find((r) => r.path === B_PATH && r.x1 > 5000)
  const fa = detsA.find((d) => near(d.bbox, [aRow.x1, aRow.y1, aRow.x2, aRow.y2]))
  const fb = detsB.find((d) => near(d.bbox, [bRow.x1, bRow.y1, bRow.x2, bRow.y2]))
  if (fa && fb && fa.embedding && fb.embedding) {
    const sim = cosine(fa.embedding, fb.embedding)
    const lowA = fa.quality === 'low' || fa.quality === 'very_low'
    const lowB = fb.quality === 'low' || fb.quality === 'very_low'
    const merges = lowA || lowB ? sim >= LOW_JOIN_SIM : sim >= CLUSTER_THRESHOLD
    console.log(`\n=== Pair A(back-of-head) vs B(side) ===`)
    console.log(`  NEW q: A=${fa.quality}, B=${fb.quality}`)
    console.log(`  sim = ${sim.toFixed(3)}`)
    console.log(`  rule: ${lowA || lowB ? `LOW join (need >= ${LOW_JOIN_SIM})` : `anchor (need >= ${CLUSTER_THRESHOLD})`}`)
    console.log(`  => ${merges ? 'MASIH MERGE ❌' : 'TIDAK MERGE ✅'}`)
  } else {
    console.log('\n  pair tidak lengkap (embedding null?)')
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
