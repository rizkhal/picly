// Check embedding determinism: detect the SAME photo twice, compare embeddings.
// If they differ, the ML pipeline is non-deterministic (bug).
const path = require('path')
const { FaceAnalysis } = require('../dist-main/ml/faceAnalysis.js')
const { cosine } = require('../dist-main/db/vec.js')

const LFW_ROOT = process.env.LFW_ROOT || '/Users/rizkal/scikit_learn_data/lfw_home/lfw_funneled'
const testFiles = [
  path.join(LFW_ROOT, 'George_W_Bush', 'George_W_Bush_0001.jpg'),
  path.join(LFW_ROOT, 'George_W_Bush', 'George_W_Bush_0002.jpg'),
  path.join(LFW_ROOT, 'Tony_Blair', 'Tony_Blair_0001.jpg'),
]

async function main() {
  const analysis = await FaceAnalysis.create()
  for (const f of testFiles) {
    const faces1 = await analysis.detect(f)
    const faces2 = await analysis.detect(f)
    console.log(`\n${path.basename(f)}`)
    console.log(`  run1: ${faces1.length} faces`)
    console.log(`  run2: ${faces2.length} faces`)
    for (let i = 0; i < Math.min(faces1.length, faces2.length); i++) {
      const sim = cosine(faces1[i].embedding, faces2[i].embedding)
      const bbox1 = faces1[i].bbox.map((v) => Math.round(v)).join(',')
      const bbox2 = faces2[i].bbox.map((v) => Math.round(v)).join(',')
      console.log(`  face ${i}: sim=${sim.toFixed(4)}  bbox1=[${bbox1}] bbox2=[${bbox2}]`)
    }
  }
  await analysis.dispose?.()
}
main().catch((e) => { console.error(e); process.exit(1) })
