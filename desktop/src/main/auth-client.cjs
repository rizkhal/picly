/**
 * Desktop auth client — talks to the Hono backend (/auth/*).
 *
 * Tokens are persisted via Electron safeStorage (OS-level encryption:
 * Keychain on macOS, DPAPI on Windows) — never plaintext on disk.
 * Main-process only; the renderer never sees raw tokens (only a boolean status
 * + email), which keeps them out of reach of any renderer XSS.
 */
const { safeStorage, app } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

const API_BASE = process.env.PICLY_API_URL || 'http://localhost:8000';
// userData dir is only available once app is ready / under full Electron; fall
// back to a stable temp path for headless runs (ELECTRON_RUN_AS_NODE).
const USER_DATA =
  typeof app?.getPath === 'function' ? app.getPath('userData') : path.join(os.tmpdir(), 'picly-auth');
const TOKEN_FILE = path.join(USER_DATA, 'auth-token.bin');

// Storage backend — safeStorage when available (encrypted), else in-memory.
// Kept behind a small seam so headless tests can inject a stub.
const memoryStore = new Map();
let storage = {
  isAvailable: () => typeof safeStorage?.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable(),
  read: () => {
    if (!fs.existsSync(TOKEN_FILE)) return null;
    const buf = fs.readFileSync(TOKEN_FILE);
    if (!storage.isAvailable()) return null;
    return safeStorage.decryptString(buf);
  },
  write: (str) => {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    const buf = safeStorage.encryptString(str);
    fs.writeFileSync(TOKEN_FILE, buf, { mode: 0o600 });
  },
  clear: () => {
    try { fs.unlinkSync(TOKEN_FILE); } catch { /* noop */ }
  },
};

function loadTokens() {
  try {
    if (!storage.isAvailable()) {
      const raw = memoryStore.get('tokens');
      return raw ? JSON.parse(raw) : null;
    }
    const str = storage.read();
    if (!str) return null;
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function saveTokens(tokens) {
  try {
    const str = JSON.stringify(tokens);
    if (storage.isAvailable()) storage.write(str);
    else memoryStore.set('tokens', str);
  } catch (e) {
    console.error('auth: failed to persist tokens', e);
  }
}

function clearTokens() {
  try { if (storage.isAvailable()) storage.clear(); else memoryStore.delete('tokens'); } catch { /* noop */ }
}

async function api(pathname, { method = 'GET', body } = {}) {
  const res = await fetch(`${API_BASE}${pathname}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(json?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = json?.error;
    throw err;
  }
  return json;
}

/** Refresh the access token using the stored refresh token. */
async function refreshAccessToken(tokens) {
  const json = await api('/auth/refresh', { method: 'POST', body: { refreshToken: tokens.refreshToken } });
  const next = { ...tokens, accessToken: json.accessToken, refreshToken: json.refreshToken };
  saveTokens(next);
  return next;
}

/** Current auth state (what the renderer is allowed to see). */
function getStatus(tokens) {
  if (!tokens?.accessToken) return { loggedIn: false, email: null };
  return { loggedIn: true, email: tokens.email || null };
}

module.exports = {
  API_BASE,
  TOKEN_FILE,
  api,
  refreshAccessToken,
  getStatus,
  loadTokens,
  saveTokens,
  clearTokens,
  _storage: storage,
};
