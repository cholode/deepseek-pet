import { contextBridge, ipcRenderer } from 'electron';
import type { PetBridge, RuntimeMessage, DebugState } from '../shared/contracts';
import type { CompanionView, CompanionPresentation } from '../shared/companion';
import type { QuickChatState, SpeechBubbleState } from '../shared/pet-chat';
import type { DiaryView } from '../shared/diary';
const bridge: PetBridge = {
  diary: request => ipcRenderer.invoke('diary', request),
  onDiary: fn => { const listener = (_e: Electron.IpcRendererEvent, state: DiaryView) => fn(state); ipcRenderer.on('diary-state', listener); return () => ipcRenderer.removeListener('diary-state', listener); },
  quickChat: request => ipcRenderer.invoke('quick-chat', request),
  onQuickChat: fn => { const listener = (_e: Electron.IpcRendererEvent, state: QuickChatState) => fn(state); ipcRenderer.on('quick-chat-state', listener); return () => { ipcRenderer.removeListener('quick-chat-state', listener); }; },
  speechBubbleState: () => ipcRenderer.invoke('speech-bubble-state'),
  sizeSpeechBubble: size => ipcRenderer.invoke('speech-bubble-size', size),
  onSpeechBubble: fn => { const listener = (_e: Electron.IpcRendererEvent, state: SpeechBubbleState | null) => fn(state); ipcRenderer.on('speech-bubble', listener); return () => { ipcRenderer.removeListener('speech-bubble', listener); }; },
  companion: request => ipcRenderer.invoke('companion', request),
  onCompanion: fn => { const listener = (_e: Electron.IpcRendererEvent, state: CompanionView) => fn(state); ipcRenderer.on('companion-state', listener); return () => ipcRenderer.removeListener('companion-state', listener); },
  onPresentation: fn => { const listener = (_e: Electron.IpcRendererEvent, value: CompanionPresentation | null) => fn(value); ipcRenderer.on('companion-presentation', listener); return () => ipcRenderer.removeListener('companion-presentation', listener); },
  bootstrap: () => ipcRenderer.invoke('bootstrap'), openPanel: () => ipcRenderer.invoke('open-panel'), contextMenu: () => ipcRenderer.invoke('context-menu'), resetPosition: () => ipcRenderer.invoke('reset-position'), showPet: () => ipcRenderer.invoke('show-pet'),
  saveSettings: s => ipcRenderer.invoke('save-settings', s), resetSettings: () => ipcRenderer.invoke('reset-settings'), importPack: () => ipcRenderer.invoke('import-pack'), reloadPacks: () => ipcRenderer.invoke('reload-packs'), openPacksFolder: () => ipcRenderer.invoke('open-packs'),
  panelRequest: r => ipcRenderer.invoke('panel-request', r), getDebug: () => ipcRenderer.invoke('get-debug'), publish: s => ipcRenderer.send('publish', s), reply: (id, r) => ipcRenderer.send('reply', id, r),
  onMessage: fn => { const listener = (_e: Electron.IpcRendererEvent, m: RuntimeMessage) => fn(m); ipcRenderer.on('runtime', listener); return () => { ipcRenderer.removeListener('runtime', listener); }; },
  onDebug: fn => { const listener = (_e: Electron.IpcRendererEvent, s: DebugState) => fn(s); ipcRenderer.on('debug', listener); return () => { ipcRenderer.removeListener('debug', listener); }; },
  hitRegions: r => ipcRenderer.send('hit-regions', r), pointerDown: point => ipcRenderer.invoke('pointer-down', point), dragStart: () => ipcRenderer.invoke('drag-start'), dragEnd: () => ipcRenderer.invoke('drag-end'),
  setViewport: viewport => ipcRenderer.invoke('set-viewport', viewport),
  moveStart: (id, dx, dy, ms, easing) => ipcRenderer.invoke('move-start', { id, dx, dy, ms, easing }), moveStop: id => ipcRenderer.invoke('move-stop', id)
};
contextBridge.exposeInMainWorld('pet', bridge);

