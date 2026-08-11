const { app, BrowserWindow, ipcMain, dialog, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');

const API_BASE = process.env.PICLY_API_URL || 'http://localhost:8000';

// Custom scheme for serving local thumbnails to the renderer (picly://thumb/<id>.jpg)
protocol.registerSchemesAsPrivileged([
  { scheme: 'picly', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.NODE_ENV === 'development' || process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  // Serve cached thumbnails from the local store: picly://thumb/<photoId>.jpg
  protocol.handle('picly', (req) => {
    try {
      const url = new URL(req.url);
      if (url.hostname === 'thumb') {
        const name = url.pathname.replace(/^\//, '');
        // Only UUIDs + .jpg — prevents path traversal
        if (!/^[0-9a-f-]{36}\.jpg$/.test(name)) {
          return new Response('bad request', { status: 400 });
        }
        const file = path.join(getLocalServices().config.thumbDir, name);
        if (!fs.existsSync(file)) return new Response('not found', { status: 404 });
        return net.fetch(pathToFileURL(file).toString());
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

// Enumerate real host-mounted volumes via df. Returns [{name, path, free_gb, total_gb}]
function listHostDisks() {
  try {
    const out = execFileSync('df', ['-kP'], { encoding: 'utf8', timeout: 5000 });
    const lines = out.split('\n').slice(1);
    const disks = [];
    const seen = new Set();
    for (const line of lines) {
      if (!line.trim()) continue;
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) continue;
      const [fs, blocks, used, avail, cap, mount] = parts;
      // Only show real mount points, not synthetic/system ones
      if (!mount.startsWith('/') || mount.includes('/System/Volumes') || mount === '/private/var') continue;
      if (mount === '/' || mount.startsWith('/Volumes/')) {
        if (seen.has(mount)) continue;
        seen.add(mount);
        const freeGb = Math.round(parseInt(avail) * 1024 / 1e9);
        const totalGb = Math.round(parseInt(blocks) * 1024 / 1e9);
        const name = mount === '/' ? 'Macintosh HD' : mount.split('/').pop() || mount;
        disks.push({ name, path: mount, free_gb: freeGb, total_gb: totalGb });
      }
    }
    return disks;
  } catch (e) {
    console.error('listHostDisks failed:', e.message);
    return [];
  }
}

// Dynamic scan: map the user's picked folder to the API container path via the
// host mounts (compose mounts /Volumes + $HOME read-only under /host). No docker
// cp / copying — the API scans the originals in place.
async function getHostMount() {
  try {
    const res = await fetch(`${API_BASE}/config`, {
      headers: { 'X-API-Key': process.env.PICLY_API_KEY || '' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------------
// Local services (compiled from src/main/local.ts -> dist-main/local.js)
// --------------------------------------------------------------------------
let localServices = null;
const runningScans = new Map();

function getLocalServices() {
  if (!localServices) {
    const { createLocalServices } = require('../dist-main/local.js');
    const dataDir = path.join(app.getPath('userData'), 'data');
    localServices = createLocalServices({
      dbPath: path.join(dataDir, 'picly.db'),
      thumbDir: path.join(dataDir, 'thumbs'),
    });
  }
  return localServices;
}

function registerLocalIpc() {
  ipcMain.handle('local:stats', () => getLocalServices().store.stats());

  ipcMain.handle('local:list-folders', () => getLocalServices().store.listFolders());
  ipcMain.handle('local:list-persons', () => getLocalServices().store.listPersons());
  ipcMain.handle('local:list-photos', (_e, folderPath) => {
    const local = getLocalServices();
    return require('../dist-main/local.js').listPhotos(local, folderPath || undefined);
  });
  ipcMain.handle('local:rename-person', (_e, personId, name) => {
    getLocalServices().store.renamePerson(personId, name);
    return true;
  });
  ipcMain.handle('local:delete-folder', (_e, hostPath) => getLocalServices().store.deleteFolder(hostPath));

  ipcMain.handle('local:search-photo', async (_e, photoPath) => {
    return require('../dist-main/local.js').searchPhoto(getLocalServices(), photoPath);
  });
  ipcMain.handle('local:search-stored-photo', async (_e, photoId) => {
    return require('../dist-main/local.js').searchStoredPhoto(getLocalServices(), photoId);
  });

  ipcMain.handle('local:scan-folder', (e, folderPath) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const { scanId, cancel, done } = require('../dist-main/local.js').startScan(
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
  ipcMain.handle('local:scan-cancel', (_e, scanId) => {
    const cancel = runningScans.get(scanId);
    if (cancel) cancel();
    return true;
  });
}

// API-based IPC (legacy — the renderer still talks to the Python backend)
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'multiSelections']
  });
  if (result.canceled || result.filePaths.length === 0) return [];

  const config = await getHostMount();
  if (!config) {
    return result.filePaths.map((p) =>
      `MAPPING_ERROR:${p}:API /config unreachable — is the backend running?`
    );
  }

  // Multi-root: [{source, target}, ...]; fall back to legacy single keys
  const mounts = (config.mounts && config.mounts.length)
    ? config.mounts
    : [{ source: config.host_mount_source, target: config.host_mount_target }];
  const normalized = mounts
    .filter((m) => m && m.source)
    .map((m) => ({
      source: (m.source || '/').replace(/\/+$/, '') || '/',
      target: (m.target || '/host').replace(/\/+$/, '') || '/host',
    }))
    .sort((a, b) => b.source.length - a.source.length); // longest prefix first

  const containerPaths = [];
  for (const hostPath of result.filePaths) {
    const match = normalized.find(
      (m) => hostPath === m.source || hostPath.startsWith(m.source + '/')
    );
    if (match) {
      const rest = hostPath.slice(match.source.length).replace(/^\/+/, '');
      containerPaths.push(`${match.target}/${rest}`.replace(/\/{2,}/g, '/'));
    } else {
      const roots = normalized.map((m) => m.source).join(', ');
      containerPaths.push(
        `MAPPING_ERROR:${hostPath}:Folder is outside any mounted root (${roots})`
      );
    }
  }
  return containerPaths;
});

ipcMain.handle('get-api-base', () => API_BASE);
ipcMain.handle('get-api-key', () => process.env.PICLY_API_KEY || '');
ipcMain.handle('list-disks', () => listHostDisks());

registerLocalIpc();
