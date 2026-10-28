import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, net, Notification, powerMonitor, protocol, safeStorage, screen, shell, Tray } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { defaults, makeCatalog, settingsSchema, type Registry } from '../shared/schema';
import { commandSchema, type CommandReceipt, type DebugState, type DesktopState, type HitRegion, type PanelRequest, type RuntimeMessage } from '../shared/contracts';
import { baseViewport, clampRect, dimensions, ease, nearestArea, nearestContainedRect, resizeAtFeet } from '../shared/geometry';
import { PackStore, readPack } from './packs';
import { SettingsStore } from './settings';
import { CompanionService } from './companion/service';
import { PetChatWindows } from './pet-chat-windows';
import { quickChatRequestSchema, type QuickChatResponse } from '../shared/pet-chat';
import { chatLink } from '../shared/chat-link';
import { quickPetStatus } from './pet-chat-status';
import { DiaryService } from './diary/service';
import { defaultDiaryDirectory } from './diary/files';
import { CompatibleModel } from './companion/model';
import { SoftwareService } from './software/service';
import { softwareActionAllowed } from '../shared/action-context';
import { StickerService } from './stickers/service';
import { ToolRouter } from '../companion/tool-router';
import { VoiceService } from './voice/service';
import { conversationPolicyDefaults } from '../shared/conversation-session';

protocol.registerSchemesAsPrivileged(['petasset', 'petsticker'].map(scheme => ({ scheme, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } })));
if (process.env.PET_TEST_USER) app.setPath('userData', path.resolve(process.env.PET_TEST_USER));
let pet: BrowserWindow; let panel: BrowserWindow | null = null; let tray: Tray; let settings: SettingsStore; let packs: PackStore; let debug: DebugState | null = null;
let regions: HitRegion[] = []; let ignored: boolean | undefined; let sampling: ReturnType<typeof setInterval> | undefined; let quitReady = false; let importBusy = false; let dragTimeout: ReturnType<typeof setTimeout> | undefined;
const desktop: DesktopState = { visible: true, dragging: false, pointerNear: false, position: { x: 0, y: 0 }, suspended: false };
let press: { x: number; y: number; windowX: number; windowY: number; time: number } | undefined;
let dragGestureId = 0;
let movement: { id: string; from: { x: number; y: number }; to: { x: number; y: number }; started: number; ms: number; easing: string } | undefined;
const pending = new Map<string, { resolve: (r: CommandReceipt) => void; timer: ReturnType<typeof setTimeout> }>();
let viewport = { ...baseViewport };
let companion: CompanionService | undefined;
let voice: VoiceService | undefined;
let diary: DiaryService | undefined;
let software: SoftwareService | undefined;
let stickers: StickerService | undefined;
let chatWindows: PetChatWindows | undefined;
const resourceRoot = () => app.isPackaged ? path.join(process.resourcesPath, 'pet-resources') : path.join(app.getAppPath(), 'resources');
const send = (m: RuntimeMessage) => { if (pet && !pet.isDestroyed()) pet.webContents.send('runtime', m); };
function error(e: unknown) { const message = e instanceof Error ? e.message : String(e); console.error(message); send({ type: 'error', error: message }); }
function trusted(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent, role: 'pet' | 'panel' | 'either' = 'either') {
  const win = BrowserWindow.fromWebContents(event.sender); const valid = role === 'pet' ? win === pet : role === 'panel' ? win === panel : win === pet || win === panel;
  if (!valid || event.senderFrame !== event.sender.mainFrame) throw new Error('IPC_FORBIDDEN');
}
function handle(name: string, role: 'pet' | 'panel' | 'either', fn: (...args: unknown[]) => unknown) { ipcMain.handle(name, (event, ...args: unknown[]) => { trusted(event, role); return fn(...args); }); }
function recordInteraction() { desktop.lastInteractionAt = Date.now(); broadcastDesktop(); }
function secureWindow(win: BrowserWindow) {
  // 只记录与桌宠窗口的真实输入；模型忙碌或聊天窗保持打开不算互动。
  win.webContents.on('before-input-event', () => recordInteraction());
  win.webContents.on('before-mouse-event', (_event, input) => { if (input.type === 'mouseDown' || input.type === 'mouseUp' || input.type === 'mouseWheel' || input.type === 'contextMenu') recordInteraction(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); win.webContents.on('will-navigate', e => e.preventDefault()); win.webContents.on('will-attach-webview', e => e.preventDefault());
  // 只有已启用语音输入且经受信任 IPC 发起录音的主框架可临时访问麦克风；摄像头始终拒绝。
  win.webContents.session.setPermissionCheckHandler((wc, permission, _origin, details) => Boolean(wc && permission === 'media' && details.isMainFrame && details.mediaType === 'audio' && voice?.permitsCapture(wc.id)));
  win.webContents.session.setPermissionRequestHandler((wc, permission, callback, details) => callback(Boolean(wc && permission === 'media' && details.isMainFrame && 'mediaTypes' in details && details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'audio' && voice?.permitsCapture(wc.id))));
  const owner = win.webContents.id;
  win.on('hide', () => { voice?.cancel(owner); if (!win.webContents.isDestroyed()) win.webContents.send('voice-event', { type: 'stop-all' }); });
  win.webContents.on('destroyed', () => voice?.cancel(owner));
  win.webContents.on('render-process-gone', (_e, info) => { voice?.cancel(owner); movement = undefined; endDrag(); dialog.showErrorBox('桌宠渲染进程异常', `请从托盘退出并重新启动。${info.reason}`); }); }
function load(win: BrowserWindow, page: string) { if (process.env.ELECTRON_RENDERER_URL && !app.isPackaged) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/?page=${page}`); else void win.loadFile(path.join(__dirname, '../renderer/index.html'), { query: { page } }); }
function openPanel() { if (panel && !panel.isDestroyed()) { panel.show(); panel.focus(); return; } panel = new BrowserWindow({ width: 1040, height: 760, minWidth: 800, minHeight: 620, title: '大肥鱼 · 桌宠小屋', backgroundColor: '#f5f7fc', autoHideMenuBar: true, icon: path.join(resourceRoot(), 'icon.png'), webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } }); secureWindow(panel); panel.on('closed', () => { panel = null; }); load(panel, 'panel'); }
function setIgnore(value: boolean) { if (ignored === value || pet.isDestroyed()) return; ignored = value; pet.setIgnoreMouseEvents(value, { forward: true }); }
function standingPosition() { const bounds = nearestContainedRect(resizeAtFeet(pet.getBounds(), dimensions(settings.value.size)),screen.getAllDisplays().map(d=>d.workArea)); return { x: bounds.x, y: bounds.y }; }
function savePosition() { if (!settings) return; void settings.save({ ...settings.value, position: standingPosition() }).catch(error); }
function resizePet() {
  const old = pet.getBounds();
  const resized = resizeAtFeet(old, dimensions(settings.value.size, viewport));
  const next = desktop.dragging ? resized : nearestContainedRect(resized,screen.getAllDisplays().map(d=>d.workArea));
  pet.setBounds(next); const dx = next.x - old.x, dy = next.y - old.y;
  if (press) { press.windowX += dx; press.windowY += dy; }
  if (movement) { movement.from.x += dx; movement.from.y += dy; movement.to.x += dx; movement.to.y += dy; }
  desktop.position = { x: next.x, y: next.y }; broadcastDesktop();
}
function broadcastDesktop() { send({ type: 'desktop', desktop: { ...desktop } }); }
function place(x: number, y: number, userDrag = false) { const rect = { ...pet.getBounds(), x, y }; const areas = screen.getAllDisplays().map(d => d.workArea); const area = userDrag ? nearestArea(rect, areas) : screen.getDisplayMatching(pet.getBounds()).workArea; const next = clampRect(rect, area); pet.setPosition(next.x, next.y, false); desktop.position = { x: next.x, y: next.y }; }
function resetPosition() { movement = undefined; endDrag(); const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea; const size = dimensions(settings.value.size, viewport); place(area.x + area.width - size.width - 24, area.y + area.height - size.height, true); savePosition(); broadcastDesktop(); }
function recoverPosition() { if (!pet || pet.isDestroyed()) return; if(desktop.dragging){endDrag();return;} const rect = nearestContainedRect(pet.getBounds(),screen.getAllDisplays().map(d=>d.workArea)); positionPet(rect.x,rect.y); savePosition(); broadcastDesktop(); }
function positionPet(x:number,y:number) { const next={x:Math.round(x),y:Math.round(y)};pet.setPosition(next.x,next.y,false);desktop.position=next; }
function sampleDrag(cursor: {x:number;y:number}) { desktop.dragSample={x:cursor.x,timeMs:performance.now(),gestureId:dragGestureId}; }
function updateDragPosition(point?:{x:number;y:number}) { if(desktop.dragging && press){const cursor=point??screen.getCursorScreenPoint();sampleDrag(cursor);positionPet(press.windowX+cursor.x-press.x,press.windowY+cursor.y-press.y);} }
function endDrag() {
  updateDragPosition(); press = undefined; if (dragTimeout) clearTimeout(dragTimeout); dragTimeout = undefined;
  if (!desktop.dragging) return; desktop.dragging = false; delete desktop.dragSample;
  // Project the standing pose, not its wider transparent swing window. The
  // renderer will restore that viewport while preserving the same feet anchor.
  const bounds=pet.getBounds(),standing=resizeAtFeet(bounds,dimensions(settings.value.size));
  const target=nearestContainedRect(standing,screen.getAllDisplays().map(d=>d.workArea));
  positionPet(bounds.x+target.x-standing.x,bounds.y+target.y-standing.y);
  savePosition(); broadcastDesktop();
}
function samplingState() { if (sampling) clearInterval(sampling); sampling = undefined; if (!desktop.visible || desktop.suspended) { chatWindows?.suspend(); return; }
  sampling = setInterval(() => {
    if (pet.isDestroyed()) return; const cursor = screen.getCursorScreenPoint(); const bounds = pet.getBounds();
    desktop.pointer={x:cursor.x-bounds.x,y:cursor.y-bounds.y};
    if (desktop.dragging && press) { updateDragPosition(cursor); }
    else if (movement) { const m = movement; const t = Math.min(1, (performance.now() - m.started) / m.ms); const f = ease(t, m.easing); place(m.from.x + (m.to.x - m.from.x) * f, m.from.y + (m.to.y - m.from.y) * f); if (t === 1) { movement = undefined; savePosition(); } }
    const hit = regions.some(r => cursor.x >= bounds.x + r.x && cursor.x <= bounds.x + r.x + r.width && cursor.y >= bounds.y + r.y && cursor.y <= bounds.y + r.y + r.height);
    desktop.pointerNear = !settings.value.clickThrough && regions.some(r => cursor.x >= bounds.x + r.x - 75 && cursor.x <= bounds.x + r.x + r.width + 75 && cursor.y >= bounds.y + r.y - 75 && cursor.y <= bounds.y + r.y + r.height + 75);
    chatWindows?.sample(cursor, hit, desktop.dragging || settings.value.clickThrough);
    const panelBounds = panel?.isVisible() && !panel.isMinimized() ? panel.getBounds() : undefined;
    const overPanel = Boolean(panelBounds && cursor.x >= panelBounds.x && cursor.x <= panelBounds.x + panelBounds.width && cursor.y >= panelBounds.y && cursor.y <= panelBounds.y + panelBounds.height);
    const interacting = desktop.pointerNear || overPanel || Boolean(chatWindows?.isPointerOver(cursor));
    if (interacting || desktop.interacting) desktop.lastInteractionAt = Date.now();
    desktop.interacting = interacting;
    setIgnore(desktop.dragging ? false : settings.value.clickThrough || !hit); broadcastDesktop();
  }, 34);
}
function showPet() { desktop.visible = true; pet.showInactive(); broadcastDesktop(); samplingState(); }
function restoreInteraction() { void applySettings({ ...settings.value, clickThrough: false }).then(showPet).catch(error); }
function menu() { return Menu.buildFromTemplate([{ label: '打开桌宠小屋', click: openPanel }, { label: '恢复交互', click: restoreInteraction }, { label: '显示桌宠', click: showPet }, { label: '隐藏桌宠', click: () => { endDrag(); movement = undefined; desktop.visible = false; pet.hide(); samplingState(); broadcastDesktop(); } }, { label: '重置位置', click: resetPosition }, { type: 'separator' }, { label: settings.value.paused ? '恢复自动行为' : '暂停自动行为', click: () => { void applySettings({ ...settings.value, paused: !settings.value.paused }).catch(error); } }, { label: '退出', click: () => app.quit() }]); }
async function applySettings(raw: unknown) { const next = settingsSchema.parse(raw); await settings.save(next); if (next.fixedPosition) { movement = undefined; endDrag(); } pet.setAlwaysOnTop(next.alwaysOnTop, 'pop-up-menu'); chatWindows?.topmost(next.alwaysOnTop); if (!next.bubbles) chatWindows?.hideSpeech(); resizePet(); savePosition(); send({ type: 'settings', settings: settings.value }); panel?.webContents.send('runtime', { type: 'settings', settings: settings.value }); samplingState(); tray?.setContextMenu(menu()); return settings.value; }
function requestRuntime(message: { type: 'request'; request: PanelRequest } | { type: 'registry'; registry: Registry }): Promise<CommandReceipt> { const id = randomUUID(); return new Promise(resolve => { const timer = setTimeout(() => { pending.delete(id); resolve({ commandId: id, status: 'rejected', errorCode: 'RUNTIME_TIMEOUT', message: '桌宠未及时响应，请重试' }); }, 15000); pending.set(id, { resolve, timer }); send({ ...message, requestId: id }); }); }
async function reload() { const next = await packs.candidate(); const result = await requestRuntime({ type: 'registry', registry: next }); if (result.status === 'rejected') throw new Error(result.message ?? result.errorCode); packs.commit(next); panel?.webContents.send('runtime', { type: 'registry', registry: next, requestId: '' }); for (const e of packs.errors) error(e); return { ok: packs.errors.length === 0, message: packs.errors.length ? `有效包已更新；以下包保留旧版：${packs.errors.join('\n')}` : '动作包重新加载成功' }; }
async function importPack() {
  if (importBusy) return { ok: false, message: '正在处理动作包，请稍候' }; importBusy = true;
  let stage: string | undefined; let backup: string | undefined; let target: string | undefined; let committed = false;
  try {
    const choice = await dialog.showOpenDialog(panel ?? pet, { title: '选择包含 pack.json 的动作包文件夹', properties: ['openDirectory'] }); if (choice.canceled) return { ok: false, message: '已取消导入' };
    const source = choice.filePaths[0]; const candidate = await readPack(source, false, packs.authorize); const id = candidate.manifest.id; target = path.join(packs.userDir, id);
    makeCatalog({ revision: 0, packs: [...packs.registry.packs.filter(p => p.manifest.id !== id), candidate] });
    const exists = await fs.stat(target).then(() => true, () => false);
    if (exists) { const answer = await dialog.showMessageBox(panel ?? pet, { type: 'question', message: `动作包“${candidate.manifest.name}”已存在，是否替换？`, buttons: ['取消', '替换'], defaultId: 0, cancelId: 0 }); if (answer.response !== 1) return { ok: false, message: '已取消替换' }; }
    stage = path.join(packs.userDir, `.import-${randomUUID()}`); await fs.cp(source, stage, { recursive: true, dereference: false }); await readPack(stage, false, packs.authorize);
    if (exists) { backup = path.join(packs.userDir, `.backup-${randomUUID()}`); await fs.rename(target, backup); }
    await fs.rename(stage, target); stage = undefined; const result = await reload(); committed = true; if (backup) await fs.rm(backup, { recursive: true, force: true }); return result;
  } catch (e) { if (!committed && target && backup) { await fs.rm(target, { recursive: true, force: true }); await fs.rename(backup, target); } else if (!committed && target && !stage) { const id = path.basename(target); if (!packs.registry.packs.some(p => p.manifest.id === id)) await fs.rm(target, { recursive: true, force: true }); } error(e); return { ok: false, message: String(e) }; }
  finally { if (stage) await fs.rm(stage, { recursive: true, force: true }); packs.commit(packs.registry); importBusy = false; }
}
async function boot() {
  settings = new SettingsStore(path.join(app.getPath('userData'), 'settings.json')); await settings.load(); packs = new PackStore(path.join(resourceRoot(), 'builtin'), path.join(app.getPath('userData'), 'action-packs')); packs.commit(await packs.candidate());
  protocol.handle('petasset', request => { const url = new URL(request.url); const file = url.hostname === 'local' ? packs.approved.get(url.pathname.slice(1)) : undefined; if (!file || request.method !== 'GET') return new Response('Forbidden', { status: 403 }); return net.fetch(pathToFileURL(file).toString()); });
  const size = dimensions(settings.value.size);
  pet = new BrowserWindow({ ...size, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false, maximizable: false, minimizable: false, skipTaskbar: true, show: false, title: 'DeepBlue Pet', webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  secureWindow(pet); pet.setAlwaysOnTop(settings.value.alwaysOnTop, 'pop-up-menu');
  if (settings.value.position) { pet.setPosition(Math.round(settings.value.position.x), Math.round(settings.value.position.y)); recoverPosition(); } else resetPosition();
  const icon = nativeImage.createFromPath(path.join(resourceRoot(), 'icon.png')); if (icon.isEmpty()) throw new Error('无法加载托盘图标'); tray = new Tray(icon.resize({ width: 32, height: 32 })); tray.setToolTip('大肥鱼桌宠 · 双击打开小屋'); tray.setContextMenu(menu()); tray.on('double-click', openPanel); tray.on('click', openPanel);
  pet.on('ready-to-show', () => { showPet(); }); pet.on('blur', endDrag); pet.on('close', () => app.quit());
  handle('bootstrap', 'either', () => ({ registry: packs.registry, settings: settings.value, desktop, errors: [...packs.errors, ...(settings.error ? [settings.error] : [])], companionEnabled: companion?.coordinator.ready ?? false }));
  // 陪伴服务只通过受限宿主端口感知桌宠，不直接修改窗口或人物图层。
  chatWindows = new PetChatWindows({ pet: () => pet, preload: path.join(__dirname, '../preload/index.js'), secure: secureWindow, load,
    regions: () => regions, movePet: (x, y) => { positionPet(x, y); broadcastDesktop(); },
    status: () => ({ ...quickPetStatus(companion?.store.data, debug, desktop, settings.value), speechEnabled: Boolean(companion?.coordinator.ready && voice?.ttsEnabled) }),
    visible: () => desktop.visible && !desktop.suspended && !desktop.dragging,
    alwaysOnTop: () => settings.value.alwaysOnTop,
    activity: open => { desktop.chatting = open; if (open && movement) { movement = undefined; savePosition(); } broadcastDesktop(); }
  });
  software = new SoftwareService(app.getPath('userData'), {
    operating: active => { desktop.softwareOperating = active; broadcastDesktop(); },
    bundled: [{ id: 'dafeiyu.anki-japanese', name: 'Anki 日语学习', directory: path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'plugins', 'anki-japanese') }],
    canRemind: () => !desktop.suspended && !desktop.dragging && !desktop.chatting && !settings.value.paused && !companion?.coordinator.busy,
    remind: text => {
      const speech = companion?.store.data.config.speech;
      if (speech && desktop.visible && settings.value.bubbles) {
        const value = { id: randomUUID(), text, emotion: 'happy' as const, source: 'initiative' as const, speech: { ...speech, enabled: false }, phase: 'complete' as const };
        pet.webContents.send('companion-presentation', value); chatWindows?.present(value, true);
      }
      if (Notification.isSupported()) { const notification = new Notification({ title: '大肥鱼 · 学习计划', body: text }); notification.on('click', openPanel); notification.show(); }
    },
    changed: state => { if (panel && !panel.isDestroyed()) panel.webContents.send('software-state', state); },
    cancelChat: () => companion?.cancel(),
    choose: async (kind, current) => {
      const result = await dialog.showOpenDialog(panel ?? pet, { title: kind === 'plugin' ? '选择下载并解压的插件目录（包含 software-plugin.json）' : kind === 'runtime' ? '选择插件使用的 Node.js 或 Python 可执行文件' : '选择软件所在目录', defaultPath: current || undefined,
        properties: kind === 'runtime' ? ['openFile'] : ['openDirectory'], ...(kind === 'runtime' ? { filters: [{ name: '可执行文件', extensions: ['exe'] }] } : {}) });
      return result.canceled ? undefined : result.filePaths[0];
    },
    seal: async value => { if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('系统密钥加密不可用，未保存明文凭证'); return (await safeStorage.encryptStringAsync(value)).toString('base64'); },
    unseal: async value => { try { return (await safeStorage.decryptStringAsync(Buffer.from(value, 'base64'))).result; } catch { throw new Error('插件凭证无法解密，请重新填写'); } }
  });
  await software.start();
  handle('software', 'panel', raw => software!.request(raw));
  stickers = new StickerService(path.join(app.getPath('userData'), 'stickers'), path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'plugins', 'nekowhale-stickers'), {
    choosePlugin: async () => { const choice = await dialog.showOpenDialog(panel ?? pet, { title: '选择解压后的表情插件目录（包含 sticker-plugin.json）', properties: ['openDirectory'] }); return choice.canceled ? undefined : choice.filePaths[0]; },
    changed: state => { if (panel && !panel.isDestroyed()) panel.webContents.send('stickers-state', state); },
    preview: text => { const speech = companion?.store.data.config.speech; if (speech) chatWindows?.present({ id: randomUUID(), phase: 'complete', text, emotion: 'calm', source: 'initiative', speech: { ...speech, enabled: false } }, true); }
  });
  await stickers.start();
  handle('stickers', 'panel', raw => stickers!.request(raw));
  protocol.handle('petsticker', async request => {
    if (request.method !== 'GET') return new Response('Forbidden', { status: 403 });
    const data = await stickers!.image(request.url);
    return data ? new Response(new Uint8Array(data), { headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }) : new Response('表情尚未缓存', { status: 404 });
  });
  companion = new CompanionService(app.getPath('userData'), {
    speechLanguages: () => voice?.speechLanguages ?? false,
    now: () => Date.now(), id: randomUUID,
    changed: state => { panel?.webContents.send('companion-state', state); chatWindows?.update(state); },
    present: value => {
      if (!value) voice?.stopAll();
      // 聊天采用新语音配置；其他入口仍可明确发送 enabled:false 的静默提醒。
      const presentation = value ? { ...value, speech: { ...value.speech, enabled: voice?.ttsEnabled ?? value.speech.enabled } } : null;
      if (!pet.isDestroyed()) pet.webContents.send('companion-presentation', presentation); panel?.webContents.send('companion-presentation', presentation); chatWindows?.present(presentation, settings.value.bubbles);
    },
    capabilities: () => (debug?.groups ?? []).map(g => ({ groupId: g.groupId, name: g.name, description: g.description, tags: g.tags, channels: g.channels, expectedDurationMs: g.expectedDurationMs, available: g.enabled && !g.interaction && !debug?.failedGroups.includes(g.groupId) && softwareActionAllowed(g, { ...desktop, interacting: desktop.interacting || desktop.dragging, paused: settings.value.paused, lastInteraction: desktop.lastInteractionAt ?? Date.now() }, Date.now()) })),
    available: () => desktop.visible && !desktop.suspended && !desktop.dragging && !desktop.chatting && !settings.value.paused,
    lastInteractionAt: () => Math.max(0, ...(debug?.events.filter(e => e.type === 'interaction').map(e => e.occurredAtUnixMs) ?? []), ...(companion?.store.data.events.filter(e => e.actor === 'user').map(e => e.at) ?? []))
  }, enabled => send({ type: 'companion-mode', enabled }), new ToolRouter([software, stickers]), () => voice?.conversationPolicy ?? conversationPolicyDefaults);
  await companion.start();
  voice = new VoiceService(path.join(app.getPath('userData'), 'conversation-settings.json'), {
    chooseVoicevoxDirectory: async () => {
      const result = await dialog.showOpenDialog(panel ?? pet, { title: '选择 VOICEVOX 解压目录或软件目录', properties: ['openDirectory'] });
      return result.canceled ? undefined : result.filePaths[0];
    },
    emit: event => { for (const window of BrowserWindow.getAllWindows()) if (!window.webContents.isDestroyed()) window.webContents.send('voice-event', event); if (event.type === 'state') chatWindows?.refreshStatus(); },
    seal: async value => { if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('系统密钥加密不可用，未保存明文凭证'); return (await safeStorage.encryptStringAsync(value)).toString('base64'); },
    unseal: async value => (await safeStorage.decryptStringAsync(Buffer.from(value, 'base64'))).result
  });
  await voice.start(companion.store.data.config.speech);
  ipcMain.handle('voice', (event, raw) => {
    const isChat = chatWindows?.isSender(event, 'chat'); if (!isChat) trusted(event);
    const owner = BrowserWindow.fromWebContents(event.sender); const role = isChat ? 'chat' : owner === panel ? 'panel' : 'pet';
    if (raw?.type === 'capture-begin' && !owner?.isVisible()) return { ok: false, message: '请在可见聊天窗口中开始录音' };
    return voice!.request(raw, event.sender.id, role);
  });
  const diaryDefault = await defaultDiaryDirectory(
    [app.getAppPath(), process.env.PORTABLE_EXECUTABLE_DIR ?? '', path.dirname(process.execPath), ...(!app.isPackaged ? [process.cwd()] : [])],
    process.env.PORTABLE_EXECUTABLE_DIR || path.join(app.getPath('documents'), '大肥鱼日记')
  );
  diary = new DiaryService(path.join(app.getPath('userData'), 'diary-settings.json'), diaryDefault, new CompatibleModel(() => companion!.secrets.get('model')), {
    now: () => Date.now(), data: () => companion!.store.data, chatBusy: () => companion?.coordinator.busy ?? false,
    changed: state => { if (panel && !panel.isDestroyed()) panel.webContents.send('diary-state', state); },
    chooseDirectory: async current => {
      const result = await dialog.showOpenDialog(panel ?? pet, { title: '选择日记保存目录', defaultPath: current, properties: ['openDirectory', 'createDirectory'] });
      return result.canceled ? undefined : result.filePaths[0];
    },
    openDirectory: async directory => { const message = await shell.openPath(directory); if (message) throw new Error(message); }
  });
  await diary.start();
  handle('diary', 'panel', raw => diary!.request(raw));
  chatWindows.update(companion.view());
  ipcMain.on('user-activity', event => { try { if (!chatWindows?.isSender(event, 'chat') && !chatWindows?.isSender(event, 'bubble')) trusted(event); recordInteraction(); } catch (e) { error(e); } });
  ipcMain.handle('chat-open-link', async (event, raw) => {
    if (!chatWindows?.isSender(event, 'bubble')) trusted(event, 'panel');
    const url = chatLink(raw); if (!url) throw new Error('仅支持 HTTP(S) 网页链接');
    recordInteraction(); await shell.openExternal(url);
  });
  ipcMain.handle('speech-bubble-dismiss', event => { if (!chatWindows?.isSender(event, 'bubble')) throw new Error('IPC_FORBIDDEN'); chatWindows.dismissSpeech(); });
  // 悬停窗口仅开放发送/停止和跳转设置，不能借此调用完整管理 IPC。
  ipcMain.handle('quick-chat', async (event, raw): Promise<QuickChatResponse> => {
    if (!chatWindows?.isSender(event, 'chat')) throw new Error('IPC_FORBIDDEN');
    const request = quickChatRequestSchema.parse(raw);
    if (request.type === 'send' || request.type === 'cancel') recordInteraction();
    if (request.type === 'tab') chatWindows.selectTab(request.tab);
    if (request.type === 'hold') chatWindows.hold(request.value);
    if (request.type === 'dismiss') chatWindows.dismiss();
    if (request.type === 'settings') {
      chatWindows.dismiss(); openPanel();
      if (panel!.webContents.isLoading()) panel!.webContents.once('did-finish-load', () => panel?.webContents.send('runtime', { type: 'open-companion' }));
      else panel!.webContents.send('runtime', { type: 'open-companion' });
    }
    if (request.type === 'send' || request.type === 'cancel') {
      const response = await companion!.request(request.type === 'send' ? { type: 'chat', text: request.text } : { type: 'cancel' });
      return { ok: response.ok, message: response.message, state: chatWindows.state() };
    }
    return { ok: true, state: chatWindows.state() };
  });
  ipcMain.handle('speech-bubble-state', event => { if (!chatWindows?.isSender(event, 'bubble')) throw new Error('IPC_FORBIDDEN'); return chatWindows.bubbleState(); });
  ipcMain.handle('speech-bubble-size', (event, raw) => { if (!chatWindows?.isSender(event, 'bubble')) throw new Error('IPC_FORBIDDEN'); chatWindows.resizeBubble(z.object({ width: z.number().int().min(120).max(440), height: z.number().int().min(48).max(320) }).strict().parse(raw)); });
  handle('companion', 'panel', raw => companion!.request(raw));
  handle('open-panel', 'either', openPanel); handle('context-menu', 'pet', () => { menu().popup({ window: pet }); }); handle('reset-position', 'either', resetPosition); handle('show-pet', 'either', showPet);
  handle('save-settings', 'panel', applySettings); handle('reset-settings', 'panel', () => applySettings(structuredClone(defaults)));
  handle('set-viewport', 'pet', raw => { const next = z.object({ width: z.number().int().min(340).max(1024), height: z.number().int().min(420).max(1024) }).strict().parse(raw); if (next.width === viewport.width && next.height === viewport.height) return; viewport = next; resizePet(); savePosition(); });
  handle('open-packs', 'panel', async () => { const e = await shell.openPath(packs.userDir); if (e) throw new Error(e); });
  handle('import-pack', 'panel', importPack); handle('reload-packs', 'panel', async () => { if (importBusy) return { ok: false, message: '正在导入' }; importBusy = true; try { return await reload(); } catch (e) { error(e); return { ok: false, message: String(e) }; } finally { importBusy = false; } });
  const panelRequestSchema = z.discriminatedUnion('type', [z.object({ type: z.literal('command'), command: commandSchema }).strict(), z.object({ type: z.literal('pause'), value: z.boolean() }).strict(), z.object({ type: z.literal('mode'), mode: z.enum(['normal', 'ai']) }).strict()]);
  handle('panel-request', 'panel', raw => requestRuntime({ type: 'request', request: panelRequestSchema.parse(raw) })); handle('get-debug', 'panel', () => debug);
  ipcMain.on('reply', (event, id: unknown, result: unknown) => { try { trusted(event, 'pet'); const key = z.string().uuid().parse(id); const r = z.object({ commandId: z.string(), status: z.enum(['accepted', 'rejected']), actionInstanceId: z.string().optional(), errorCode: z.string().optional(), message: z.string().optional() }).strict().parse(result); const waiter = pending.get(key); if (waiter) { clearTimeout(waiter.timer); pending.delete(key); waiter.resolve(r); } } catch (e) { error(e); } });
  ipcMain.on('publish', (event, state: DebugState) => { try { trusted(event, 'pet'); if (!state || JSON.stringify(state).length > 1000000 || state.snapshot?.snapshotVersion !== 1 || !Array.isArray(state.groups) || !Array.isArray(state.errors)) return; debug = state; companion?.observe(state.events ?? []); chatWindows?.refreshStatus(); panel?.webContents.send('debug', state); } catch (e) { error(e); } });
  ipcMain.on('hit-regions', (event, raw: unknown) => { try { trusted(event, 'pet'); regions = z.array(z.object({ target: z.enum(['head', 'body']), x: z.number().finite().min(-1000).max(2000), y: z.number().finite().min(-1000).max(2000), width: z.number().finite().min(0).max(2000), height: z.number().finite().min(0).max(2000) }).strict()).max(8).parse(raw); } catch (e) { error(e); } });
  handle('pointer-down', 'pet', raw => { const p = z.object({x:z.number().finite(),y:z.number().finite()}).strict().parse(raw); const b = pet.getBounds(); if(!regions.some(r=>p.x>=b.x+r.x-8 && p.x<=b.x+r.x+r.width+8 && p.y>=b.y+r.y-8 && p.y<=b.y+r.y+r.height+8)) throw new Error('POINTER_OUTSIDE_PET'); press = { ...p, windowX: b.x, windowY: b.y, time: Date.now() }; });
  handle('drag-start', 'pet', () => { if (settings.value.fixedPosition || settings.value.clickThrough || !press || Date.now() - press.time > 10000) return false; if(desktop.dragging)return true; movement = undefined; dragGestureId++; desktop.dragging = true; setIgnore(false); updateDragPosition(); dragTimeout = setTimeout(endDrag, 30000); broadcastDesktop(); samplingState(); return true; });
  handle('drag-end', 'pet', endDrag);
  handle('move-start', 'pet', raw => { const m = z.object({ id: z.string().min(1).max(100), dx: z.number().finite().min(-1000).max(1000), dy: z.number().finite().min(-1000).max(1000), ms: z.number().finite().min(1).max(30000), easing: z.enum(['linear', 'easeOut', 'easeInOut']) }).strict().parse(raw); if (settings.value.fixedPosition || desktop.dragging || !desktop.visible) throw new Error('MOVEMENT_LOCKED'); const b = pet.getBounds(); const to = clampRect({ ...b, x: b.x + m.dx, y: b.y + m.dy }, screen.getDisplayMatching(b).workArea); movement = { id: m.id, from: { x: b.x, y: b.y }, to, started: performance.now(), ms: m.ms, easing: m.easing }; samplingState(); });
  handle('move-stop', 'pet', id => { if (movement?.id === id) { movement = undefined; savePosition(); samplingState(); } });
  screen.on('display-added', recoverPosition); screen.on('display-removed', recoverPosition); screen.on('display-metrics-changed', recoverPosition);
  powerMonitor.on('suspend', () => { movement = undefined; endDrag(); desktop.suspended = true; companion?.cancel(); diary?.suspend(); samplingState(); broadcastDesktop(); }); powerMonitor.on('resume', () => { desktop.suspended = false; recoverPosition(); diary?.resume(); samplingState(); broadcastDesktop(); });
  globalShortcut.register('CommandOrControl+Alt+P', restoreInteraction);
  load(pet, 'pet'); if (process.argv.includes('--panel')) openPanel();
  diary.startAutomatic();
}
if (!app.requestSingleInstanceLock()) app.quit(); else { app.on('second-instance', () => { showPet(); openPanel(); }); void app.whenReady().then(boot).catch(e => { dialog.showErrorBox('大肥鱼启动失败', String(e)); app.exit(1); }); }
app.on('before-quit', e => {
  if (quitReady) return;
  e.preventDefault(); quitReady = true;
  if (sampling) clearInterval(sampling);
  if (dragTimeout) clearTimeout(dragTimeout);
  movement = undefined; globalShortcut.unregisterAll();
  chatWindows?.dispose();
  voice?.stopAll();
  for (const p of pending.values()) clearTimeout(p.timer);
  pending.clear();
  // 等待持久化队列落盘，防止退出时丢失最后一句对话或新记忆。
  void Promise.allSettled([
    companion?.close(),
    voice?.close(),
    diary?.close(),
    settings?.save({ ...settings.value, position: pet && !pet.isDestroyed() ? standingPosition() : desktop.position })
  ]).finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());





