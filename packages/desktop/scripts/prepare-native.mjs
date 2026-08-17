// Select the better-sqlite3 binary for the current runtime.
//
// better-sqlite3 v13 crashes inside Electron's Node 20 (node-addon-api v8 uses
// node::SetCppgcReference, absent in ABI 130), so we pin v11.10.0 and compile
// it twice via rebuild-native.mjs (postinstall): abi/host.node for the host
// Node (tsx tests) and abi/electron.node for Electron. This script copies the
// wanted one over build/Release/better_sqlite3.node, which `bindings` loads.
//
//   node scripts/prepare-native.mjs node      # host Node (default; tsx tests)
//   node scripts/prepare-native.mjs electron  # Electron (dev + packaged app)
import { copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(root, 'node_modules', 'better-sqlite3');
const src = join(pkgDir, 'abi', process.argv[2] === 'electron' ? 'electron.node' : 'host.node');
const dest = join(pkgDir, 'build', 'Release', 'better_sqlite3.node');

if (!existsSync(src)) {
  console.error(`prepare-native: ${src} missing — run "bun install" (postinstall rebuilds both)`);
  process.exit(1);
}
copyFileSync(src, dest);
console.log(`prepare-native: active binary -> ${process.argv[2] || 'node'} ABI`);
