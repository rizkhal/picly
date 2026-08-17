// Isolate native-module crashes inside Electron.
// Run: CHECK=better-sqlite3 electron scripts/electron-native-check.cjs
const { app } = require('electron');
const path = require('path');

const which = process.env.CHECK;

app.whenReady().then(async () => {
  try {
    if (which === 'better-sqlite3' || !which) {
      console.log('step: require better-sqlite3');
      const Database = require('better-sqlite3');
      console.log('step: open memory db');
      const db = new Database(':memory:');
      db.exec('CREATE TABLE t(x); INSERT INTO t VALUES (1)');
      console.log('better-sqlite3 OK:', db.prepare('SELECT x FROM t').get());
      db.close();
    }
    if (which === 'sharp' || !which) {
      console.log('step: require sharp');
      const sharp = require('sharp');
      console.log('step: sharp op');
      const buf = await sharp({
        create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } },
      })
        .jpeg()
        .toBuffer();
      console.log('sharp OK:', buf.length, 'bytes');
    }
    if (which === 'onnxruntime' || !which) {
      console.log('step: require onnxruntime-node');
      const ort = require('onnxruntime-node');
      console.log('step: create session');
      const detPath = path.join(process.env.HOME, '.insightface', 'models', 'buffalo_l', 'det_10g.onnx');
      const sess = await ort.InferenceSession.create(detPath, { executionProviders: ['cpu'] });
      console.log('onnxruntime OK, inputs:', sess.inputNames.length);
    }
    console.log(`CHECK [${which || 'all'}] PASS`);
    app.exit(0);
  } catch (e) {
    console.error(`CHECK [${which || 'all'}] FAIL:`, e);
    app.exit(1);
  }
});
