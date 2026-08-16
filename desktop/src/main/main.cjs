const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { getApiBase } = require('./config.cjs');

const API_BASE = getApiBase();

// macOS menu bar (next to the Apple logo) shows this — default is "Electron".
// Set before window/UI creation so the app menu label follows the app name.
app.setName('Picly');

// Custom scheme for serving local thumbnails to the renderer (picly://thumb/<id>.jpg)
protocol.registerSchemesAsPrivileged([
  { scheme: 'picly', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function createWindow() {
  // Window icon — bundled into the app (build/icon.png is in electron-builder
  // "files"), resolved relative to the asar root.
  const appIcon = path.join(__dirname, '../../build/icon.png');
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    // Explicit title so the title bar shows "Picly" immediately — the HTML
    // <title> only applies after the page loads, so without this the bar
    // briefly (or permanently, if the load stalls) shows Electron's default.
    title: 'Picly',
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Keep DevTools available in dev (VITE_DEV_SERVER_URL) for debugging;
      // disable in the packaged app so end users can't inspect internals.
      devTools: !app.isPackaged,
    },
  });

  if (process.env.NODE_ENV === 'development' || process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    // Packaged: renderer lives at app.asar/dist/index.html (electron-builder
    // "files" puts dist/ at the asar root). __dirname is app.asar/src/main,
    // so index.html is TWO levels up, not one.
    win.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  // Keep the title bar as "Picly" even if the page never sets a title.
  win.on('page-title-updated', (e, title) => {
    e.preventDefault();
    win.setTitle('Picly');
  });
}

app.whenReady().then(() => {
  // macOS: the native About panel + top app-menu label are taken from the
  // running bundle's CFBundleName — in dev that's Electron.app, so they show
  // "Electron" no matter what app.name is. setAboutPanelOptions overrides what
  // the About panel displays.
  if (process.platform === 'darwin') {
    app.setAboutPanelOptions({
      applicationName: 'Picly',
      applicationVersion: app.getVersion(),
    });
  }

  // macOS: rebuild the app menu so the first item (next to the Apple logo)
  // reads "Picly" instead of the Electron default. Using an explicit label
  // (rather than role: 'appMenu', which hardcodes the Electron label) ensures
  // the menu bar always shows the app name.
  if (process.platform === 'darwin') {
    const template = [
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
      { role: 'help' },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  // Serve cached thumbnails + face crops from the local store:
  //   picly://thumb/<photoId>.jpg  — full-photo thumbnail
  //   picly://face/<faceId>.jpg    — cropped face preview
  //   picly://src/<photoId>.jpg    — the ORIGINAL source image (full resolution)
  protocol.handle('picly', (req) => {
    try {
      const url = new URL(req.url);
      const host = url.hostname; // 'thumb' | 'face' | 'src'
      const name = url.pathname.replace(/^\//, '');
      if (host === 'thumb' || host === 'face') {
        // Only UUIDs + .jpg — prevents path traversal
        if (!/^[0-9a-f-]{36}\.jpg$/.test(name)) {
          return new Response('bad request', { status: 400 });
        }
        const file = path.join(getLocalServices().config.thumbDir, name);
        if (!fs.existsSync(file)) return new Response('not found', { status: 404 });
        return net.fetch(pathToFileURL(file).toString());
      }
      if (host === 'src') {
        // Only UUIDs + .jpg — resolves the stored original photo path (no traversal)
        if (!/^[0-9a-f-]{36}\.jpg$/.test(name)) {
          return new Response('bad request', { status: 400 });
        }
        const photoId = name.replace(/\.jpg$/, '');
        const photo = getLocalServices().store.getPhoto(photoId);
        if (!photo || !photo.path || !fs.existsSync(photo.path)) return new Response('not found', { status: 404 });
        return net.fetch(pathToFileURL(photo.path).toString());
      }

      return new Response('not found', { status: 404 });
    } catch {
      return new Response('bad request', { status: 400 });
    }
  });
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

// Folder picker — returns host paths directly (no backend mapping needed; the
// local scanner reads the host filesystem in place).
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'multiSelections']
  });
  return result.canceled || result.filePaths.length === 0 ? [] : result.filePaths;
});

// --------------------------------------------------------------------------
// Local services (compiled from src/main/local.ts -> dist-main/local.js)
// --------------------------------------------------------------------------
let localServices = null;
const runningScans = new Map();

function getLocalServices() {
  if (!localServices) {
    // dist-main is a sibling of src/ (tsc outDir) — from src/main, that's ../../dist-main
    const target = path.resolve(__dirname, '../../dist-main/local.js');
    const { createLocalServices } = require(target);
    const dataDir = path.join(app.getPath('userData'), 'data');
    localServices = createLocalServices({
      dbPath: path.join(dataDir, 'picly.db'),
      thumbDir: path.join(dataDir, 'thumbs'),
      // "Better absent than blurry": drop faces with eDifFIQA below 0.25 at
      // scan time so blurry rectangles never reach the UI/DB. Faces below this
      // are not stored — only the usable faces remain (and get optimized).
      minFaceQuality: 0.25,
    });
  }
  return localServices;
}

function registerLocalIpc() {
  ipcMain.handle('local:stats', () => getLocalServices().store.stats());

  ipcMain.handle('local:list-folders', () => getLocalServices().store.listFolders());
  ipcMain.handle('local:list-persons', (_e, showSingletons) => getLocalServices().store.listPersons(false, !!showSingletons));
  ipcMain.handle('local:list-photos', (_e, folderPath) => {
    const local = getLocalServices();
    const rows = require('../../dist-main/local.js').listPhotos(local, folderPath || undefined);
    return rows.map((p) => ({ ...p, thumbUrl: p.thumbPath ? `picly://thumb/${path.basename(p.thumbPath)}` : null }));
  });
  ipcMain.handle('local:list-person-photos', (_e, personId) => {
    const local = getLocalServices();
    return require('../../dist-main/local.js').listPersonPhotos(local, personId);
  });
  ipcMain.handle('local:list-person-previews', (_e, ids) => {
    const local = getLocalServices();
    return require('../../dist-main/local.js').listPersonPreviews(local, ids || []);
  });
  ipcMain.handle('local:list-no-face-photos', () => {
    const local = getLocalServices();
    return require('../../dist-main/local.js').listPhotosNoFaces(local);
  });
  ipcMain.handle('local:count-no-face-photos', () => {
    const local = getLocalServices();
    return require('../../dist-main/local.js').countPhotosNoFaces(local);
  });

  ipcMain.handle('local:photo-faces', (_e, photoId) => {
    const local = getLocalServices();
    return require('../../dist-main/local.js').photoFaces(local, photoId);
  });

  ipcMain.handle('local:delete-photo', (_e, photoId) => {
    getLocalServices().store.deletePhoto(photoId);
    return true;
  });
  ipcMain.handle('local:trash-photos', (_e, photoIds) => {
    const store = getLocalServices().store;
    for (const id of photoIds || []) store.deletePhoto(id);
    return true;
  });
  ipcMain.handle('local:list-trash', () => require('../../dist-main/local.js').listTrashedPhotos(getLocalServices()));
  ipcMain.handle('local:count-trash', () => getLocalServices().store.countTrashed());
  ipcMain.handle('local:restore-photo', (_e, photoId) => require('../../dist-main/local.js').restorePhoto(getLocalServices(), photoId));
  ipcMain.handle('local:empty-trash', () => require('../../dist-main/local.js').emptyTrash(getLocalServices()));
  ipcMain.handle('local:rename-person', (_e, personId, name) => {
    getLocalServices().store.renamePerson(personId, name);
    return true;
  });
  // Manual person editing — merge/split/single-face assign. These record
  // person_manual so a startup re-cluster never un-does the user's edits.
  ipcMain.handle('local:merge-persons', (_e, targetId, sourceIds) =>
    require('../../dist-main/local.js').mergePersons(getLocalServices(), targetId, sourceIds || []),
  );
  ipcMain.handle('local:split-person', (_e, personId) =>
    require('../../dist-main/local.js').splitPerson(getLocalServices(), personId),
  );
  ipcMain.handle('local:set-face-person', (_e, faceId, personId) =>
    require('../../dist-main/local.js').setFacePerson(getLocalServices(), faceId, personId),
  );
  ipcMain.handle('local:assign-faces-to-person', (_e, sourcePersonId, targetPersonId) =>
    require('../../dist-main/local.js').assignFacesToPerson(getLocalServices(), sourcePersonId, targetPersonId),
  );
  ipcMain.handle('local:list-faces-for-person', (_e, personId) =>
    require('../../dist-main/local.js').listFacesForPerson(getLocalServices(), personId),
  );
  ipcMain.handle('local:delete-folder', (_e, hostPath) => getLocalServices().store.deleteFolder(hostPath));

  ipcMain.handle('local:search-photo', async (_e, photoPath) => {
    return require('../../dist-main/local.js').searchPhoto(getLocalServices(), photoPath);
  });
  ipcMain.handle('local:search-stored-photo', async (_e, photoId) => {
    return require('../../dist-main/local.js').searchStoredPhoto(getLocalServices(), photoId);
  });
  ipcMain.handle('local:search-photos-by-name', (_e, query) => {
    const local = getLocalServices();
    return require('../../dist-main/local.js').searchPhotosByName(local, String(query || ''));
  });

  // Cleanup (manage-photos page) — all irreversible, confirm in the renderer.
  ipcMain.handle('local:cleanup-stats', () => require('../../dist-main/local.js').cleanupStats(getLocalServices()));
  ipcMain.handle('local:cleanup-unassigned-faces', () => require('../../dist-main/local.js').removeUnassignedFaces(getLocalServices()));
  ipcMain.handle('local:cleanup-low-quality-faces', () => require('../../dist-main/local.js').removeLowQualityFaces(getLocalServices()));
  ipcMain.handle('local:cleanup-duplicates', () => require('../../dist-main/local.js').listDuplicateGroups(getLocalServices()));
  ipcMain.handle('local:cleanup-empty-persons', () => require('../../dist-main/local.js').removeEmptyPersons(getLocalServices()));
  ipcMain.handle('local:cleanup-orphan-thumbs', () => require('../../dist-main/local.js').removeOrphanThumbs(getLocalServices()));

  ipcMain.handle('local:scan-folder', (e, folderPath) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const { scanId, cancel, done } = require('../../dist-main/local.js').startScan(
      getLocalServices(),
      folderPath,
      (p) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('local:scan-progress', p);
        }
      },
    );
    runningScans.set(scanId, cancel);
    done
      .then((summary) => {
        if (win && !win.isDestroyed()) win.webContents.send('local:scan-progress', { ...summary, status: summary.cancelled ? 'cancelled' : 'done', scanId });
      })
      .catch((err) => {
        console.error('local scan failed:', err);
        if (win && !win.isDestroyed()) win.webContents.send('local:scan-progress', { scanId, status: 'error' });
      })
      .finally(() => runningScans.delete(scanId));
    return { scanId };
  });
  // Rescan an existing folder — delta sync (new files added, missing files removed).
  ipcMain.handle('local:rescan-folder', (e, folderPath) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const { scanId, cancel, done } = require('../../dist-main/local.js').startScan(
      getLocalServices(),
      folderPath,
      (p) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('local:scan-progress', p);
        }
      },
      'rescan',
    );
    runningScans.set(scanId, cancel);
    done
      .then((summary) => {
        if (win && !win.isDestroyed()) win.webContents.send('local:scan-progress', { ...summary, status: summary.cancelled ? 'cancelled' : 'done', scanId });
      })
      .catch((err) => {
        console.error('local rescan failed:', err);
        if (win && !win.isDestroyed()) win.webContents.send('local:scan-progress', { scanId, status: 'error' });
      })
      .finally(() => runningScans.delete(scanId));
    return { scanId };
  });
  ipcMain.handle('local:scan-cancel', (_e, scanId) => {
    const cancel = runningScans.get(scanId);
    if (cancel) cancel();
    return true;
  });
}

// --- Auth IPC (Fase 2: desktop auth) ---

// --- App utility IPC (open original in Finder etc) ---
function registerAppIpc() {
  ipcMain.handle('app:show-item', (_e, filePath) => {
    try {
      if (typeof filePath !== 'string' || !filePath) return false;
      shell.showItemInFolder(filePath);
      return true;
    } catch (e) {
      console.error('showItemInFolder failed:', e);
      return false;
    }
  });

  // Reload the renderer (keeps the main process / local services / DB alive).
  // The persisted page (picly:page) puts the user back where they were.
  ipcMain.handle('app:reload', (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return false;
      win.reload();
      return true;
    } catch (e) {
      console.error('app:reload failed:', e);
      return false;
    }
  });
}

const authClient = require('./auth-client.cjs');

function registerAuthIpc() {
  ipcMain.handle('auth:status', () => {
    const tokens = authClient.loadTokens();
    return authClient.getStatus(tokens);
  });

  ipcMain.handle('auth:register', async (_e, email, password) => {
    try {
      const json = await authClient.api('/auth/register', { method: 'POST', body: { email, password } });
      authClient.saveTokens({ accessToken: json.accessToken, refreshToken: json.refreshToken, email: json.user.email });
      return { ok: true, email: json.user.email };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle('auth:login', async (_e, email, password) => {
    try {
      const json = await authClient.api('/auth/login', { method: 'POST', body: { email, password } });
      authClient.saveTokens({ accessToken: json.accessToken, refreshToken: json.refreshToken, email: json.user.email });
      return { ok: true, email: json.user.email };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle('auth:logout', async () => {
    const tokens = authClient.loadTokens();
    if (tokens?.refreshToken) {
      try { await authClient.api('/auth/logout', { method: 'POST', body: { refreshToken: tokens.refreshToken } }); } catch { /* best-effort */ }
    }
    authClient.clearTokens();
    return { ok: true };
  });

  // Renderer requests a fresh access token for authenticated API calls
  ipcMain.handle('auth:get-access-token', async () => {
    const tokens = authClient.loadTokens();
    if (!tokens) return { ok: false, error: 'not_logged_in' };
    try {
      const fresh = await authClient.refreshAccessToken(tokens);
      return { ok: true, accessToken: fresh.accessToken };
    } catch (e) {
      authClient.clearTokens();
      return { ok: false, error: e.message || String(e) };
    }
  });
}

registerAuthIpc();

// API-based IPC (legacy — kept for in-app update checks later)
ipcMain.handle('get-api-base', () => API_BASE);


// In-app update seam: the backend serves release manifests for the desktop app.
// Renderer calls this to check for a new version; main is the only place that
// knows the packaged app version (process.env.npm_package_version / app.getVersion).
ipcMain.handle('app:check-update', async () => {
  try {
    const res = await fetch(`${API_BASE}/app/update`, {
      // Endpoint is public ??? manifest is not sensitive (see backend/src/update.ts)
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { available: false, error: `HTTP ${res.status}` };
    const body = await res.json();
    // Endpoint returns { available, manifest: { version, url, notes, models } }
    const manifest = body.manifest || body;
    const current = app.getVersion();
    const available = !!(manifest.version && manifest.version !== current);
    return { available, current, latest: manifest.version || null, url: manifest.url || null, notes: manifest.notes || null, models: manifest.models || null };
  } catch (e) {
    return { available: false, error: String(e && e.message ? e.message : e) };
  }
});

// The ML models actually installed on this device (basename of each ONNX file).
// Lets Settings show "your models vs. latest" and detect a model-only mismatch
// even when the app version matches (bundled models updated without a bump).
ipcMain.handle('app:local-models', () => {
  try {
    const { localModels, defaultModelsDir } = require('../../dist-main/ml/config.js');
    return localModels(defaultModelsDir());
  } catch (e) {
    console.error('local-models failed:', e);
    return { detector: null, recognizer: null, quality: null };
  }
});

// Open the release page in the system browser (v1: no auto-download).
ipcMain.handle('app:open-update', async (_e, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return { ok: false, error: 'invalid_url' };
  await shell.openExternal(url);
  return { ok: true };
});

registerLocalIpc();
registerAppIpc();
