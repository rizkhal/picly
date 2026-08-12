#!/usr/bin/env node
/**
 * Smoke-test the bundled ONNX models with the ACTUAL Electron runtime
 * (onnxruntime-node compiled for Electron ABI, not Node).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 electron scripts/verify-models.cjs
 *
 * Verifies:
 *   - desktop/models/buffalo_l contains det_10g.onnx + w600k_r50.onnx
 *   - onnxruntime-node loads BOTH models into sessions on the CPU EP
 *   - det_10g produces the expected 9 SCRFD outputs
 */
const path = require('path');
const fs = require('fs');

const MODELS_DIR = path.resolve(__dirname, '../models/buffalo_l');
const NEEDED = ['det_10g.onnx', 'w600k_r50.onnx'];

async function main() {
  for (const name of NEEDED) {
    const p = path.join(MODELS_DIR, name);
    const s = fs.statSync(p);
    if (!s.size) throw new Error(`${name} is empty`);
    console.log(`ok  ${name} (${(s.size / 1e6).toFixed(1)} MB)`);
  }

  const ort = require('onnxruntime-node');
  console.log('ort load OK, ABI:', process.versions.modules);

  const detPath = path.join(MODELS_DIR, 'det_10g.onnx');
  const arcPath = path.join(MODELS_DIR, 'w600k_r50.onnx');
  const det = await ort.InferenceSession.create(detPath, { executionProviders: ['cpu'] });
  console.log('det session OK, inputs:', det.inputNames.length, 'outputs:', det.outputNames.length);
  if (det.outputNames.length !== 9) throw new Error(`expected 9 outputs, got ${det.outputNames.length}`);

  const arc = await ort.InferenceSession.create(arcPath, { executionProviders: ['cpu'] });
  console.log('arc session OK, inputs:', arc.inputNames.length, 'outputs:', arc.outputNames.length);

  console.log('PASS: bundled models load under Electron runtime');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL:', err && err.message ? err.message : err);
  process.exit(1);
});
