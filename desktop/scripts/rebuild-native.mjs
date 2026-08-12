// Build better-sqlite3 v11 for BOTH the host Node and Electron's ABI.
//
// Why: better-sqlite3 v13 (node-addon-api v8, engines node>=22) SIGSEGVs inside
// Electron 33's Node 20.18 (node_module_register -> node::SetCppgcReference),
// even rebuilt. v11.10.0 (node-addon-api v6) has no such path and works once
// compiled against the Electron headers. bun blocks dependency lifecycle
// scripts, so this runs as the project's own postinstall.
//
// node-gyp rebuild() runs `make clean` which wipes build/Release, so compiled
// results are copied to better-sqlite3/abi/ (untouched by clean):
//   abi/host.node     <- host Node ABI (tsx tests)
//   abi/electron.node <- Electron ABI (app)
// prepare-native.mjs copies the wanted one over build/Release/better_sqlite3.node.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(root, 'node_modules', 'better-sqlite3');
if (!existsSync(join(pkgDir, 'binding.gyp'))) {
  console.log('rebuild-native: better-sqlite3 not installed, skipping');
  process.exit(0);
}

const electronVersion = existsSync(join(root, 'node_modules', 'electron', 'package.json'))
  ? JSON.parse(readFileSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version
  : null;

const release = join(pkgDir, 'build', 'Release');
const abiDir = join(pkgDir, 'abi');
mkdirSync(abiDir, { recursive: true });
const gyp = (args) =>
  execFileSync(join(root, 'node_modules', '.bin', 'node-gyp'), args, {
    cwd: pkgDir,
    stdio: 'inherit',
    env: { ...process.env, npm_config_arch: process.arch },
  });

// 1. Host Node ABI — what tsx tests run under.
console.log('rebuild-native: better-sqlite3 for host Node…');
gyp(['rebuild', '--release', '--force_build=1']);
copyFileSync(join(release, 'better_sqlite3.node'), join(abiDir, 'host.node'));

// 2. Electron ABI — only when Electron is installed.
if (electronVersion) {
  console.log(`rebuild-native: better-sqlite3 for Electron ${electronVersion}…`);

  // Point node-gyp at the Electron headers via --dist-url. node-gyp downloads
  // them into its cache (~/Library/Caches/node-gyp) on first use; --nodedir
  // with @electron/get headers is NOT supported (artifact resolves to a 404),
  // so keep the proven --dist-url path for fresh CI runners.
  gyp([
    'rebuild',
    '--release',
    '--force_build=1',
    `--target=${electronVersion}`,
    `--arch=${process.arch}`,
    '--dist-url=https://electronjs.org/headers',
  ]);
  copyFileSync(join(release, 'better_sqlite3.node'), join(abiDir, 'electron.node'));
}

// Default active slot = host Node (tests); electron:dev/build run
// prepare-native.mjs electron first, so the slot is correct either way.
copyFileSync(join(abiDir, 'host.node'), join(release, 'better_sqlite3.node'));
console.log('rebuild-native: done (abi/host.node + abi/electron.node saved)');
