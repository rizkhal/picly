// Cross-platform launcher for the headless Electron ABI check.
//
// `ELECTRON_RUN_AS_NODE=1 electron ...` is POSIX-only (breaks in cmd.exe on
// Windows), so this sets the env var in-process and spawns Electron. The
// packaged app targets Windows/Linux/macOS (see electron-builder config).
const { spawn } = require('child_process');
const path = require('path');
const { createRequire } = require('module');

const requireFromDesktop = createRequire(path.join(__dirname, '..', 'package.json'));
const electronPath = requireFromDesktop('electron'); // resolves to dist/<binary> path string

const child = spawn(electronPath, [path.join(__dirname, 'electron-abi-check.cjs')], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
child.on('exit', (code) => process.exit(code ?? 0));
