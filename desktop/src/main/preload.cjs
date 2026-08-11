const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  // Legacy API-based IPC (Python backend)
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getApiBase: () => ipcRenderer.invoke('get-api-base'),
  getApiKey: () => ipcRenderer.invoke('get-api-key'),
  listDisks: () => ipcRenderer.invoke('list-disks'),

  // In-app update check (backend serves the release manifest)
  checkUpdate: () => ipcRenderer.invoke('app:check-update'),

  // Local services (SQLite store + ONNX pipeline, no backend needed)
  local: {
    stats: () => ipcRenderer.invoke('local:stats'),
    listFolders: () => ipcRenderer.invoke('local:list-folders'),
    listPersons: () => ipcRenderer.invoke('local:list-persons'),
    listPhotos: (folderPath) => ipcRenderer.invoke('local:list-photos', folderPath),
    listPersonPhotos: (personId) => ipcRenderer.invoke('local:list-person-photos', personId),
    renamePerson: (personId, name) => ipcRenderer.invoke('local:rename-person', personId, name),
    deleteFolder: (hostPath) => ipcRenderer.invoke('local:delete-folder', hostPath),
    deletePhoto: (photoId) => ipcRenderer.invoke('local:delete-photo', photoId),
    searchPhoto: (photoPath) => ipcRenderer.invoke('local:search-photo', photoPath),
    searchStoredPhoto: (photoId) => ipcRenderer.invoke('local:search-stored-photo', photoId),
    scanFolder: (folderPath) => ipcRenderer.invoke('local:scan-folder', folderPath),
    cancelScan: (scanId) => ipcRenderer.invoke('local:scan-cancel', scanId),
    onScanProgress: (cb) => {
      const listener = (_e, progress) => cb(progress);
      ipcRenderer.on('local:scan-progress', listener);
      return () => ipcRenderer.removeListener('local:scan-progress', listener);
    },
  },
});
