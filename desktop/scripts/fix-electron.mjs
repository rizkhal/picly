// Ensure Electron binary + path.txt exist. bun 1.3.x blocks dep lifecycle
// scripts (electron postinstall) even with trustedDependencies. This runs as
// the project's own postinstall, which bun always executes.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'electron');
const bin = process.platform === 'win32'
  ? 'electron.exe'
  : process.platform === 'darwin'
    ? 'Electron.app/Contents/MacOS/Electron'
    : 'electron';

if (existsSync(join(pkgDir, 'path.txt')) && existsSync(join(pkgDir, 'dist', bin))) {
  process.exit(0);
}

mkdirSync(join(pkgDir, 'dist'), { recursive: true });
const { downloadArtifact } = await import('@electron/get');
const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
const zip = await downloadArtifact({ version, artifactName: 'electron', arch: process.arch });
// System unzip; extract-zip (used by electron install.js) silently fails here.
execFileSync('unzip', ['-q', '-o', zip, '-d', join(pkgDir, 'dist')], { stdio: 'inherit' });
writeFileSync(join(pkgDir, 'path.txt'), bin);
