/**
 * Pipeline verification harness (Phase 1 gate).
 *
 * Runs the Node ML pipeline over the golden fixture photos and compares
 * against the Python InsightFace reference:
 *   - bbox IoU            >= 0.90
 *   - embedding cosSim    >= 0.97 (raw-kps embedding target, ~1.0 expected)
 *   - estimate_norm M     max abs diff < 0.01 (exact umeyama port check)
 *   - self-consistency    cosSim > 0.999 when the same image runs twice
 *
 * Run: bun run verify:pipeline   (or: npx tsx scripts/verify-pipeline.ts)
 *
 * Fixtures (golden.json) live in docs/ml-parity/ — generated once from the Python
 * insightface reference (see docs/ml-parity/gen_fixtures.py), then frozen.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ARCFACE_DST, FaceAnalysis } from '../src/main/ml/index'
import { umeyama } from '../src/main/ml/matrix'
import type { GoldenFixture, GoldenFixturePhoto } from '../src/main/ml/types'

const IO_U_MIN = 0.9
const COS_MIN = 0.97
// umeyama unit-test tolerance: same kps in -> same M out (algorithm exactness).
const M_UNIT_MAX_DIFF = 0.001
const SELF_COS_MIN = 0.999

function iou(a: number[], b: number[]): number {
  const x1 = Math.max(a[0], b[0])
  const y1 = Math.max(a[1], b[1])
  const x2 = Math.min(a[2], b[2])
  const y2 = Math.min(a[3], b[3])
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const areaA = (a[2] - a[0]) * (a[3] - a[1])
  const areaB = (b[2] - b[0]) * (b[3] - b[1])
  return inter / (areaA + areaB - inter)
}

function cosSim(a: Float32Array | number[], b: Float32Array | number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function maxAbsDiff(a: number[][], b: number[][]): number {
  let m = 0
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < a[i].length; j++) {
      m = Math.max(m, Math.abs(a[i][j] - b[i][j]))
    }
  }
  return m
}

function pad(v: number, w = 7): string {
  return v.toFixed(4).padStart(w)
}

async function main(): Promise<void> {
  const fixturesDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'docs',
    'ml-parity',
  )
  const golden = JSON.parse(await readFile(path.join(fixturesDir, 'golden.json'), 'utf8')) as GoldenFixture
  const photos: GoldenFixturePhoto[] = golden.photos

  const analysis = await FaceAnalysis.create()
  console.log(`Reference: ${golden.reference}\n`)

  let pass = true
  for (const entry of photos) {
    const faces = await analysis.detect(entry.photo)
    const used = new Set<number>()
    const rows: string[] = []
    for (let d = 0; d < faces.length; d++) {
      const f = faces[d]
      let best = -1
      let bestIoU = -0.1
      for (let g = 0; g < entry.faces.length; g++) {
        if (used.has(g)) continue
        const gi = iou(f.bbox, entry.faces[g].bbox)
        if (gi > bestIoU) {
          bestIoU = gi
          best = g
        }
      }
      if (best < 0) {
        rows.push(`  Face [${d}]: NO MATCH — bbox ${f.bbox.map((v) => Math.round(v)).join(',')}`)
        pass = false
        continue
      }
      used.add(best)
      const g = entry.faces[best]
      if (!f.embedding || !g.embedding) {
        rows.push(
          `  Face [${d}]: SKIP — missing embedding (low quality), IoU=${pad(bestIoU)}`,
        )
        continue
      }
      const sim = cosSim(f.embedding, g.embedding)
      const refSim = g.ref_embedding ? cosSim(f.embedding, g.ref_embedding) : NaN
      const mDiff = maxAbsDiff(umeyama(f.kps, ARCFACE_DST), g.M)
      const ok = bestIoU >= IO_U_MIN && sim >= COS_MIN
      if (!ok) pass = false
      rows.push(
        `  Face [${d}]: IoU=${pad(bestIoU)} cosSim=${pad(sim)} ` +
          `(ref=${pad(refSim)}) Mdiff=${mDiff.toFixed(5)} ${ok ? 'PASS' : 'FAIL'}`,
      )
    }
    if (faces.length !== entry.faces.length) {
      pass = false
      rows.push(
        `  WARN: face count differs — detected ${faces.length}, fixture ${entry.faces.length}`,
      )
    }
    console.log(path.basename(entry.photo))
    for (const r of rows) console.log(r)
  }

  // umeyama unit test: feeding the FIXTURE kps through our port must reproduce
  // the fixture M exactly (algorithm exactness, independent of detector noise).
  let umeyamaOk = true
  for (const entry of photos) {
    for (const g of entry.faces) {
      const mDiff = maxAbsDiff(umeyama(g.kps, ARCFACE_DST), g.M)
      if (mDiff >= M_UNIT_MAX_DIFF) umeyamaOk = false
      console.log(
        `  umeyama(${path.basename(entry.photo)}): Mdiff=${mDiff.toFixed(7)} ${mDiff < M_UNIT_MAX_DIFF ? 'PASS' : 'FAIL'}`,
      )
    }
  }
  if (!umeyamaOk) pass = false

  // Self-consistency: the same image must produce an identical embedding.
  const first = photos[0]
  const [a1, a2] = await Promise.all([analysis.detect(first.photo), analysis.detect(first.photo)])
  const e1 = a1[0]?.embedding
  const e2 = a2[0]?.embedding
  if (!e1 || !e2) {
    console.log('\nSelf-consistency: SKIP — no embedding (low quality)')
  } else {
    const selfSim = cosSim(e1, e2)
    const selfOk = selfSim > SELF_COS_MIN
    if (!selfOk) pass = false
    console.log(
      `\nSelf-consistency (${path.basename(first.photo)}): cosSim=${selfSim.toFixed(6)} ${selfOk ? 'PASS' : 'FAIL'}`,
    )
  }

  console.log(pass ? '\n=== ALL PASS ===' : '\n=== SOME FAILURES ===')
  process.exit(pass ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
