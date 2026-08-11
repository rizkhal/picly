// Electron auth smoke — validates the Fase 2 desktop auth flow inside Electron.
//
// 1. Loads auth-client.cjs (uses safeStorage for token persistence).
// 2. Registers a fresh account against a running backend (PICLY_API_URL).
// 3. Confirms tokens persisted + status reflects logged-in.
// 4. Logs out and confirms tokens cleared.
//
// Run (backend must be up first):
//   PICLY_API_URL=http://localhost:18100 node scripts/prepare-native.mjs electron \
//     && ELECTRON_RUN_AS_NODE=1 electron scripts/auth-smoke.cjs
//
// NOTE: ELECTRON_RUN_AS_NODE has no safeStorage (needs GUI); use full electron
//       (electron scripts/auth-smoke.cjs) for the real safeStorage path.
const { safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const API = process.env.PICLY_API_URL || 'http://localhost:8000';
const EMAIL = `smoke-${Date.now()}@picly.test`;

async function run() {
  const fail = (msg) => {
    console.error('AUTH SMOKE FAIL:', msg);
    process.exit(1);
  };
  try {
    if (!safeStorage?.isEncryptionAvailable?.()) {
      console.log('safeStorage not available (headless) — using in-memory storage');
    }

    const authClient = require(path.join(__dirname, '..', 'src', 'main', 'auth-client.cjs'));

    // 1. Register
    const reg = await authClient.api('/auth/register', {
      method: 'POST',
      body: { email: EMAIL, password: 'secret123' },
    });
    if (!reg.accessToken || !reg.refreshToken) return fail('register returned no tokens');
    console.log('1. register OK:', reg.user.email);

    // 2. Persist + status
    authClient.saveTokens({ accessToken: reg.accessToken, refreshToken: reg.refreshToken, email: reg.user.email });
    const status1 = authClient.getStatus(authClient.loadTokens());
    if (!status1.loggedIn) return fail('status not logged-in after save');
    console.log('2. persist + status OK:', status1.email);

    // 3. Refresh rotation (backend revokes the old refresh token)
    const fresh = await authClient.refreshAccessToken(authClient.loadTokens());
    if (!fresh.accessToken || !fresh.refreshToken) return fail('refresh returned no tokens');
    if (fresh.refreshToken === reg.refreshToken) return fail('refresh token did not rotate');
    console.log('3. refresh rotation OK');

    // 4. Logout — clear local + revoke server-side
    await authClient.api('/auth/logout', { method: 'POST', body: { refreshToken: fresh.refreshToken } });
    authClient.clearTokens();
    const status2 = authClient.getStatus(authClient.loadTokens());
    if (status2.loggedIn) return fail('status still logged-in after logout');
    console.log('4. logout + clear OK');

    // 5. Revoked refresh token must now be rejected
    const rejected = await authClient.api('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: fresh.refreshToken },
    }).then(() => false).catch((e) => e.status === 401);
    if (!rejected) return fail('revoked refresh token was not rejected');
    console.log('5. revoked refresh rejected OK');

    console.log('=== AUTH SMOKE PASS ===');
    process.exit(0);
  } catch (e) {
    fail((e && e.stack) || String(e));
  }
}

run();
