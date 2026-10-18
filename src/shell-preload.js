const { contextBridge, ipcRenderer } = require('electron');

let maximized = false;
const stateListeners = new Set();

ipcRenderer.on('window-is-maximized', () => {
  maximized = true;
  stateListeners.forEach((listener) => listener(maximized));
});

ipcRenderer.on('window-is-unmaximized', () => {
  maximized = false;
  stateListeners.forEach((listener) => listener(maximized));
});

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  onStateChange(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('onStateChange requires a callback');
    }
    stateListeners.add(callback);
    callback(maximized);
    return () => stateListeners.delete(callback);
  }
});
