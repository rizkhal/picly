const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const API_BASE = process.env.PICLY_API_URL || 'http://localhost:8000';

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
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

const { execFile } = require('child_process');
const { randomBytes } = require('crypto');

// Dynamic scan: copy the user's picked folder into the API container's
// shared uploads volume, then return the container path to scan. No docker
// mounts / compose changes needed — any host folder works.
const API_CONTAINER = 'picly-api-1';
const SCAN_DEST = '/tmp/picly_uploads';

function dockerCp(src, dest) {
  return new Promise((resolve, reject) => {
    execFile('docker', ['cp', src, dest], (err) => err ? reject(err) : resolve());
  });
}

// IPC handlers
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'multiSelections']
  });
  if (result.canceled || result.filePaths.length === 0) return [];

  const containerPaths = [];
  for (const hostPath of result.filePaths) {
    const token = randomBytes(6).toString('hex');
    const containerPath = `${SCAN_DEST}/scan_${token}`;
    try {
      await dockerCp(`${hostPath}/.`, `${API_CONTAINER}:${containerPath}`);
      containerPaths.push(containerPath);
    } catch (e) {
      containerPaths.push(`MAPPING_ERROR:${hostPath}:${e.message}`);
    }
  }
  return containerPaths;
});

ipcMain.handle('get-api-base', () => API_BASE);
ipcMain.handle('get-api-key', () => process.env.PICLY_API_KEY || '');
