import { contextBridge, ipcRenderer } from 'electron';
import type { PetBridge, RuntimeMessage, DebugState } from '../shared/contracts';
const bridge: PetBridge = {
  bootstrap: () => ipcRenderer.invoke('bootstrap'), openPanel: () => ipcRenderer.invoke('open-panel'), contextMenu: () => ipcRenderer.invoke('context-menu'), resetPosition: () => ipcRenderer.invoke('reset-position'), showPet: () => ipcRenderer.invoke('show-pet'),
  saveSettings: s => ipcRenderer.invoke('save-settings', s), resetSettings: () => ipcRenderer.invoke('reset-settings'), importPack: () => ipcRenderer.invoke('import-pack'), reloadPacks: () => ipcRenderer.invoke('reload-packs'), openPacksFolder: () => ipcRenderer.invoke('open-packs'),
  panelRequest: r => ipcRenderer.invoke('panel-request', r), getDebug: () => ipcRenderer.invoke('get-debug'), publish: s => ipcRenderer.send('publish', s), reply: (id, r) => ipcRenderer.send('reply', id, r),
  onMessage: fn => { const listener = (_e: Electron.IpcRendererEvent, m: RuntimeMessage) => fn(m); ipcRenderer.on('runtime', listener); return () => { ipcRenderer.removeListener('runtime', listener); }; },
  onDebug: fn => { const listener = (_e: Electron.IpcRendererEvent, s: DebugState) => fn(s); ipcRenderer.on('debug', listener); return () => { ipcRenderer.removeListener('debug', listener); }; },
  hitRegions: r => ipcRenderer.send('hit-regions', r), pointerDown: point => ipcRenderer.invoke('pointer-down', point), dragStart: () => ipcRenderer.invoke('drag-start'), dragEnd: () => ipcRenderer.invoke('drag-end'),
  moveStart: (id, dx, dy, ms, easing) => ipcRenderer.invoke('move-start', { id, dx, dy, ms, easing }), moveStop: id => ipcRenderer.invoke('move-stop', id)
};
contextBridge.exposeInMainWorld('pet', bridge);

