const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('catchApi', {
  enter: (types) => ipcRenderer.send('catch:enter', types),
  over: () => ipcRenderer.send('catch:over'),
  drop: (paths, note) => ipcRenderer.send('catch:drop', paths, note),
  pathForFile: (file) => webUtils.getPathForFile(file),
});
