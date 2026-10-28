// Bridge between the Studio / overlay pages and the main process.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => ipcRenderer.on(channel, (_event, payload) => cb(payload));

contextBridge.exposeInMainWorld('companion', {
  // Studio
  savePackage: (bytes, name) => ipcRenderer.invoke('pkg:save', bytes, name),
  importPackage: (bytes) => ipcRenderer.invoke('pkg:import', bytes),
  pickAndImport: () => ipcRenderer.invoke('pkg:pick-import'),
  listLibrary: () => ipcRenderer.invoke('lib:list'),

  // Desktop overlay
  getActive: () => ipcRenderer.invoke('overlay:get-active'),
  setIgnoreMouse: (ignore) => ipcRenderer.send('overlay:set-ignore', ignore),
  showMenu: (payload) => ipcRenderer.send('overlay:menu', payload),
  openStudio: () => ipcRenderer.send('app:open-studio'),
  onAdd: on('overlay:add'),
  onRemove: on('overlay:remove'),
  onCommand: on('overlay:command'),
  onTyping: on('overlay:typing'),
  wantTyping: (on) => ipcRenderer.send('overlay:want-typing', on),

  // Self-test
  selftestInfo: () => ipcRenderer.invoke('selftest:info'),
  capture: (name) => ipcRenderer.invoke('selftest:capture', name),
  selftestDone: (ok) => ipcRenderer.send('selftest:done', ok),
  devSave: (rel, bytes) => ipcRenderer.invoke('dev:save', rel, bytes),
});
