// Electron smoke test — validates Phase 3 integration.
//
// 1. Native modules (better-sqlite3, sharp, onnxruntime-node) load inside the
//    Electron main process. sharp + onnxruntime are pure N-API; better-sqlite3
//    is compiled for Electron's ABI by scripts/rebuild-native.mjs + selected
//    via scripts/prepare-native.mjs electron.
// 2. The compiled local services layer (dist-main/local.js) scans a folder,
//    clusters faces, and searches — all inside Electron.
//
// Run: bun run smoke:electron   (builds dist-main first, then launches Electron)
//
// NOTE: this needs a GUI session (app.whenReady). From a headless shell use
// `bun run abi:check` instead (ELECTRON_RUN_AS_NODE, same coverage minus GUI).
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const TEST_PHOTOS = process.env.PICLY_TEST_PHOTOS || '/Users/rizkal/picly-photos-local';

app.whenReady().then(async () => {
  const fail = (msg) => {
    console.error('SMOKE FAIL:', msg);
    app.exit(1);
  };
  try {
    // ---- 1. Native module ABI check -------------------------------------
    const Database = require('better-sqlite3');
    const sharp = require('sharp');
    const ort = require('onnxruntime-node');

    const db = new Database(':memory:');
    db.exec('CREATE TABLE t(x)');
    db.exec('INSERT INTO t VALUES (1)');
    db.close();

    const buf = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .jpeg()
      .toBuffer();
    if (!buf || buf.length < 100) return fail('sharp produced no output');

    const detPath = path.join(process.env.HOME, '.insightface', 'models', 'buffalo_l', 'det_10g.onnx');
    const sess = await ort.InferenceSession.create(detPath, { executionProviders: ['cpu'] });
    if (!sess.inputNames.length) return fail('onnxruntime session has no inputs');
    console.log('native modules OK in Electron (better-sqlite3, sharp, onnxruntime-node) — no rebuild needed');

    // ---- 2. Compiled local services end-to-end --------------------------
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
    if (summary.scanned < 30) return fail(`scan scanned too few photos: ${summary.scanned}`);

    const persons = services.store.listPersons();
    console.log('persons clustered:', persons.length);
    if (persons.length < 10) return fail(`unexpectedly few persons: ${persons.length}`);

    const res = await local.searchPhoto(services, path.join(TEST_PHOTOS, 'woman_001.jpg'));
    console.log('search top hit:', JSON.stringify(res.hits && res.hits[0]));
    if (!res.hits || res.hits.length === 0) return fail('search returned no hits');
    if (res.hits[0].similarity < 0.99) return fail(`self-match similarity too low: ${res.hits[0].similarity}`);

    const stats = services.store.stats();
    console.log('store stats:', JSON.stringify(stats));

    console.log('=== ELECTRON SMOKE PASS ===');
    app.exit(0);
  } catch (e) {
    fail((e && e.stack) || String(e));
  }
});
