const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  // Legacy API-based IPC (Python backend)
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getApiBase: () => ipcRenderer.invoke('get-api-base'),
  listDisks: () => ipcRenderer.invoke('list-disks'),

  // Electron 32+: File.path was removed — resolve the path via webUtils
  // (preload is the only place that can safely touch the file object).
  getPathForFile: (file) => (file ? webUtils.getPathForFile(file) : null),

  // In-app update check (backend serves the release manifest)
  checkUpdate: () => ipcRenderer.invoke('app:check-update'),
  openUpdate: (url) => ipcRenderer.invoke('app:open-update', url),
  // Reveal the original file in the system file manager (Finder/Explorer)
  showItem: (filePath) => ipcRenderer.invoke('app:show-item', filePath),

  // Auth (account/entitlement — tokens stay in main via safeStorage)
  auth: {
    status: () => ipcRenderer.invoke('auth:status'),
    register: (email, password) => ipcRenderer.invoke('auth:register', email, password),
    login: (email, password) => ipcRenderer.invoke('auth:login', email, password),
    logout: () => ipcRenderer.invoke('auth:logout'),
    getAccessToken: () => ipcRenderer.invoke('auth:get-access-token'),
  },

  // Local services (SQLite store + ONNX pipeline, no backend needed)
  local: {
    stats: () => ipcRenderer.invoke('local:stats'),
    listFolders: () => ipcRenderer.invoke('local:list-folders'),
    listPersons: () => ipcRenderer.invoke('local:list-persons'),
    listPhotos: (folderPath) => ipcRenderer.invoke('local:list-photos', folderPath),
    listPersonPhotos: (personId) => ipcRenderer.invoke('local:list-person-photos', personId),
    listPersonPreviews: (ids) => ipcRenderer.invoke('local:list-person-previews', ids),
    photoFaces: (photoId) => ipcRenderer.invoke('local:photo-faces', photoId),
    faceBoxesForPerson: (personId, photoIds) => ipcRenderer.invoke('local:face-boxes-for-person', personId, photoIds),
    renamePerson: (personId, name) => ipcRenderer.invoke('local:rename-person', personId, name),
    deleteFolder: (hostPath) => ipcRenderer.invoke('local:delete-folder', hostPath),
    deletePhoto: (photoId) => ipcRenderer.invoke('local:delete-photo', photoId),
    searchPhoto: (photoPath) => ipcRenderer.invoke('local:search-photo', photoPath),
    searchStoredPhoto: (photoId) => ipcRenderer.invoke('local:search-stored-photo', photoId),
    scanFolder: (folderPath) => ipcRenderer.invoke('local:scan-folder', folderPath),
    rescanFolder: (folderPath) => ipcRenderer.invoke('local:rescan-folder', folderPath),
    cancelScan: (scanId) => ipcRenderer.invoke('local:scan-cancel', scanId),
    onScanProgress: (cb) => {
      const listener = (_e, progress) => cb(progress);
      ipcRenderer.on('local:scan-progress', listener);
      return () => ipcRenderer.removeListener('local:scan-progress', listener);
    },
  },
});
