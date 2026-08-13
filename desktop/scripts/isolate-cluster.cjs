#!/usr/bin/env node
/**
 * Validate true-HAC clusterAllFaces inside Electron's Node runtime (correct ABI
 * for better-sqlite3). Opens a COPY of the live DB so nothing is mutated.
 *
 * Run: node scripts/prepare-native.mjs electron && \
 *      ELECTRON_RUN_AS_NODE=1 electron scripts/isolate-cluster.cjs
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

const candidates = [
  path.join(os.homedir(), 'Library/Application Support/Picly/data/picly.db'),
  path.join(os.homedir(), 'Library/Application Support/picly-desktop/data/picly.db'),
];
const dbPath = candidates.find((p) => fs.existsSync(p));
if (!dbPath) { console.error('no db found'); process.exit(1); }

const tmp = `/tmp/picly-cluster-test-${process.pid}.db`;
fs.copyFileSync(dbPath, tmp);
console.log('DB:', dbPath);
console.log('copied to', tmp);

// Load compiled store from dist-main (built via bun run build:local).
const { PhotoStore } = require('../dist-main/db/store.js');

const store = PhotoStore.open(tmp);
try {
  console.log('store opened OK');
  const t0 = Date.now();
  const count = store.clusterAllFaces();
  console.log(`clusterAllFaces done in ${Date.now() - t0}ms — persons: ${count}`);
  const persons = store.listPersons();
  const sizes = persons.map((p) => p.faceCount).sort((a, b) => b - a);
  console.log(`listPersons: ${persons.length} | top sizes: ${sizes.slice(0, 10).join(', ')}`);
  const person33 = persons.find((p) => p.name === 'Person 33');
  console.log(`Person 33 faceCount now: ${person33 ? person33.faceCount : 'GONE'}`);
} finally {
  store.close();
  fs.unlinkSync(tmp);
  console.log('store closed');
}
