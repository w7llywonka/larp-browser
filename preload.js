'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('browser', {
  command: line => ipcRenderer.invoke('browser:command', String(line)),
  state: () => ipcRenderer.invoke('browser:state'),
  resume: () => ipcRenderer.invoke('browser:resume'),
  configure: value => ipcRenderer.invoke('browser:configure', value),
  noteRead: () => ipcRenderer.invoke('browser:note-read'),
  noteSave: value => ipcRenderer.invoke('browser:note-save', value),
  onEditor: callback => ipcRenderer.on('browser:editor', (_event, value) => callback(value)),
  onPanic: callback => ipcRenderer.on('browser:panic', () => callback()),
  onOutput: callback => ipcRenderer.on('browser:output', (_event, output) => callback(output)),
  onFocus: callback => ipcRenderer.on('browser:focus', (_event, value) => callback(value)),
  onState: callback => ipcRenderer.on('browser:state', (_event, state) => callback(state))
});
