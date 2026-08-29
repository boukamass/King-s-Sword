
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  onUpdateAvailable: (callback) => ipcRenderer.on('update_available', callback),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update_downloaded', callback),
  restartApp: () => ipcRenderer.send('restart_app'),
  printPage: () => ipcRenderer.send('print-page'),
  db: {
    // Sermons
    getSermonsMetadata: () => ipcRenderer.invoke('db:getSermonsMetadata'),
    getSermonFull: (id) => ipcRenderer.invoke('db:getSermonFull', id),
    search: (params) => ipcRenderer.invoke('db:search', params),
    importSermons: (sermons) => ipcRenderer.invoke('db:importSermons', sermons),
    // Notes
    getNotes: () => ipcRenderer.invoke('db:getNotes'),
    saveNote: (note) => ipcRenderer.invoke('db:saveNote', note),
    deleteNote: (id) => ipcRenderer.invoke('db:deleteNote', id),
    reorderNotes: (notes) => ipcRenderer.invoke('db:reorderNotes', notes),
    // Songs
    getSongs: () => ipcRenderer.invoke('db:getSongs'),
    getSong: (id) => ipcRenderer.invoke('db:getSong', id),
    saveSong: (song) => ipcRenderer.invoke('db:saveSong', song),
    deleteSong: (id) => ipcRenderer.invoke('db:deleteSong', id),
    bulkImportSongs: (songs) => ipcRenderer.invoke('db:bulkImportSongs', songs),
    // Key-Value Store
    getKV: (key) => ipcRenderer.invoke('db:getKV', key),
    setKV: (key, value) => ipcRenderer.invoke('db:setKV', key, value),
    // Backup & Restore
    exportBackup: () => ipcRenderer.invoke('backup:exportUserData'),
    importBackup: (backupData) => ipcRenderer.invoke('backup:importUserData', backupData),
  },
  security: {
    getLockStatus: () => ipcRenderer.invoke('security:getLockStatus'),
    activateDevice: (activationCode) => ipcRenderer.invoke('security:activateDevice', activationCode),
    encryptSecureData: (plainText) => ipcRenderer.invoke('security:encryptSecureData', plainText),
    decryptSecureData: (cipherText) => ipcRenderer.invoke('security:decryptSecureData', cipherText),
  }
});
