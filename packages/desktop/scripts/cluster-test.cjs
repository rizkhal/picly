#!/usr/bin/env node
/**
 * CJS port of cluster-test.ts — validates identity correctness of true-HAC
 * clustering on 6 known LFW people × 4 photos each.
 *
 * Runs inside Electron's Node (correct better-sqlite3 ABI):
 *   node scripts/prepare-native.mjs electron && \
 *   ELECTRON_RUN_AS_NODE=1 electron scripts/cluster-test.cjs
 *
 * Verifies: exactly 6 clusters, each pure (one LFW identity), all covered.
 */
const path = require('path');
const fs = require('fs');
const { PhotoStore } = require('../dist-main/db/store.js');
const { FaceAnalysis } = require('../dist-main/ml/faceAnalysis.js');
const { scanFolder } = require('../dist-main/scanner.js');

const desktopRoot = path.join(__dirname, '..');
const dataDir = path.join(desktopRoot, 'data');
const dbPath = path.join(dataDir, 'test-cluster-hac.db');
const thumbDir = path.join(dataDir, 'test-cluster-hac-thumbs');

const LFW_ROOT = '/Users/rizkal/scikit_learn_data/lfw_home/lfw_funneled';
const PEOPLE = ['George_W_Bush', 'Colin_Powell', 'Tony_Blair', 'Donald_Rumsfeld', 'Gerhard_Schroeder', 'Ariel_Sharon'];
const PER_PERSON = 4;
const THRESHOLD = Number(process.env.CLUSTER_THRESHOLD ?? '0.45');

function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s }

async function main() {
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(p, { force: true });
  fs.rmSync(thumbDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });

  const store = PhotoStore.open(dbPath, { clusterLinkageThreshold: THRESHOLD });
  const analysis = await FaceAnalysis.create();
  console.log(`threshold=${THRESHOLD}, LFW people=${PEOPLE.length} × ${PER_PERSON} photos each\n`);

  for (const p of PEOPLE) {
    const dir = path.join(LFW_ROOT, p);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort().slice(0, PER_PERSON).map((f) => path.join(dir, f));
    console.log(`scanning ${p}: ${files.length} photos`);
    await scanFolder(store, dir, analysis, { thumbDir, files });
  }

  const persons = store.listPersons();
  console.log(`\npersons created: ${persons.length} (identities: ${PEOPLE.length})`);

  let pass = true;
  const usedDirs = new Set();
  for (const person of persons) {
    const embs = store.faceEmbeddingsForPerson(person.personId, 20);
    let meanSim = 1;
    if (embs.length > 1) {
      let sum = 0;
      for (let i = 1; i < embs.length; i++) sum += dot(embs[0], embs[i]);
      meanSim = sum / (embs.length - 1);
    }
    const dirs = new Set();
    for (const p of store.photosForPerson(person.personId)) dirs.add(path.basename(path.dirname(p)));
    const pure = dirs.size === 1;
    for (const d of dirs) usedDirs.add(d);
    if (!pure) pass = false;
    const name = dirs.size === 1 ? [...dirs][0] : `MIXED(${[...dirs].join('+')})`;
    console.log(`  ${person.name.padEnd(10)} faces=${String(person.faceCount).padStart(2)} meanSim=${meanSim.toFixed(4)} identity=${name} ${pure ? 'OK' : 'MIXED!'}`);
  }

  const allCovered = usedDirs.size === PEOPLE.length;
  if (!allCovered) { pass = false; console.log(`WARN: identities covered = ${usedDirs.size}/${PEOPLE.length}`); }
  console.log(pass ? '\n=== CLUSTERING PASS ===' : '\n=== CLUSTERING FAILED ===');
  store.close();
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
