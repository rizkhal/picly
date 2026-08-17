// Picly main-process config — single source of truth for app-level settings.
//
// Backend base URL (auth + in-app update):
//   Priority: PICLY_API_URL env > packaged default (VPS) > local dev fallback.
//   - `PICLY_API_URL` always wins (dev overrides, staging, self-hosted).
//   - Packaged apps (electron-builder) default to the production backend so
//     end users connect without any setup.
//   - `electron .` / `bun run dev` (process.defaultApp) defaults to the local
//     Docker backend on localhost:9999.
// Detect packaged app reliably.
// - `electron .` / `bun run dev` → process.defaultApp === true → dev.
// - Packaged apps → defaultApp undefined AND (under Electron) app.isPackaged.
// - Headless CLI (auth-smoke, verify scripts, plain node) → no Electron app;
//   app.isPackaged is undefined → treat as dev (localhost fallback).
const isPackaged = (() => {
  if (process.defaultApp === true || process.env.PICLY_DEV) return false;
  try {
    // Only meaningful inside Electron; requires('electron') in plain node
    // returns the binary path string, which is falsy-safe here.
    const electronApp = require('electron')?.app;
    return electronApp?.isPackaged === true;
  } catch {
    return false;
  }
})();

const PRODUCTION_API_URL = 'https://api.picly.rizkal.wtf';

function getApiBase() {
  if (process.env.PICLY_API_URL) return process.env.PICLY_API_URL;
  if (isPackaged) return PRODUCTION_API_URL;
  return 'http://localhost:9999';
}

module.exports = {
  isPackaged,
  PRODUCTION_API_URL,
  getApiBase,
};
