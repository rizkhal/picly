// Validates Phase 3 integration under Electron's Node runtime.
//
// ELECTRON_RUN_AS_NODE=1 electron scripts/electron-abi-check.cjs  (or: bun run abi:check)
//  - native modules must load under Electron's ABI
//  - compiled local services (dist-main/local.js) scan + search end-to-end
//
// Set PICLY_TEST_PHOTOS to a photo folder (defaults to ~/picly-photos-local).
//
// (The GUI/Chromium part of Electron can't run from non-GUI shells; that path
//  is exercised with `bun run electron:dev` from a normal desktop session.)
const path = require('path');

const TEST_PHOTOS = process.env.PICLY_TEST_PHOTOS || '/Users/rizkal/picly-photos-local';

async function main() {
  console.log('electron node:', process.versions.node, '| modules ABI:', process.versions.modules);

  // ---- 1. Native modules under Electron ABI -----------------------------
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE t(x); INSERT INTO t VALUES (42)');
  if (db.prepare('SELECT x FROM t').get().x !== 42) throw new Error('better-sqlite3 wrong value');
  db.close();
  console.log('better-sqlite3 OK (Electron ABI)');

  const sharp = require('sharp');
  const buf = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } },
  })
    .jpeg()
    .toBuffer();
  if (!buf || buf.length < 100) throw new Error('sharp produced no output');
  console.log('sharp OK (Electron ABI)');

  const ort = require('onnxruntime-node');
  const detPath = path.join(process.env.HOME, '.insightface', 'models', 'buffalo_l', 'det_10g.onnx');
  const sess = await ort.InferenceSession.create(detPath, { executionProviders: ['cpu'] });
  if (!sess.inputNames.length) throw new Error('onnxruntime session has no inputs');
  console.log('onnxruntime-node OK (Electron ABI) — no @electron/rebuild needed');

  // ---- 2. Compiled local services end-to-end ----------------------------
  const fs = require('fs');
  const local = require(path.join(__dirname, '..', 'dist-main', 'local.js'));
  const dir = '/tmp/picly-e2e';
  fs.rmSync(dir, { recursive: true, force: true });
  const services = local.createLocalServices({
    dbPath: path.join(dir, 'picly.db'),
    thumbDir: path.join(dir, 'thumbs'),
  });

  const handle = local.startScan(services, TEST_PHOTOS, () => {});
  const summary = await handle.done;
  console.log('scan summary:', JSON.stringify(summary));
  if (summary.scanned < 30) throw new Error(`scan scanned too few photos: ${summary.scanned}`);

  const persons = services.store.listPersons();
  console.log('persons clustered:', persons.length);
  if (persons.length < 10) throw new Error(`unexpectedly few persons: ${persons.length}`);

  const res = await local.searchPhoto(services, path.join(TEST_PHOTOS, 'woman_001.jpg'));
  if (!res.hits || res.hits.length === 0) throw new Error('search returned no hits');
  if (res.hits[0].similarity < 0.99) throw new Error(`self-match too low: ${res.hits[0].similarity}`);
  console.log('search top hit:', JSON.stringify(res.hits[0]));
  console.log('store stats:', JSON.stringify(services.store.stats()));

  console.log('=== ELECTRON ABI + SERVICES PASS ===');
}

main().catch((e) => {
  console.error('ABI CHECK FAIL:', e && e.stack ? e.stack : e);
  process.exit(1);
});
