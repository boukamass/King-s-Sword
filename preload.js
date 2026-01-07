
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
  }
});
