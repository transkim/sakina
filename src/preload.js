const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sakinaDesktop', {
  platform: process.platform,
  // offline Quran recitation (files saved in the app data folder)
  quranAudio: {
    list: (reciter) => ipcRenderer.invoke('quran:list', reciter),
    download: (reciter, items) => ipcRenderer.invoke('quran:download', reciter, items),
    cancel: () => ipcRenderer.invoke('quran:cancel'),
    remove: (reciter, names) => ipcRenderer.invoke('quran:remove', reciter, names),
    onProgress: (cb) => { const h = (e, p) => cb(p); ipcRenderer.on('quran:progress', h); return () => ipcRenderer.removeListener('quran:progress', h); },
  },
});
