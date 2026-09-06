import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, net, powerMonitor, protocol, screen, shell, Tray } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { defaults, makeCatalog, settingsSchema, type Registry } from '../shared/schema';
import { commandSchema, type CommandReceipt, type DebugState, type DesktopState, type HitRegion, type PanelRequest, type RuntimeMessage } from '../shared/contracts';
import { clampRect, dimensions, ease, nearestArea } from '../shared/geometry';
import { PackStore, readPack } from './packs';
import { SettingsStore } from './settings';

protocol.registerSchemesAsPrivileged([{ scheme: 'petasset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
if (process.env.PET_TEST_USER) app.setPath('userData', path.resolve(process.env.PET_TEST_USER));
let pet: BrowserWindow; let panel: BrowserWindow | null = null; let tray: Tray; let settings: SettingsStore; let packs: PackStore; let debug: DebugState | null = null;
let regions: HitRegion[] = []; let ignored: boolean | undefined; let sampling: ReturnType<typeof setInterval> | undefined; let quitReady = false; let importBusy = false; let dragTimeout: ReturnType<typeof setTimeout> | undefined;
const desktop: DesktopState = { visible: true, dragging: false, pointerNear: false, position: { x: 0, y: 0 }, suspended: false };
let press: { x: number; y: number; windowX: number; windowY: number; time: number } | undefined;
let movement: { id: string; from: { x: number; y: number }; to: { x: number; y: number }; started: number; ms: number; easing: string } | undefined;
const pending = new Map<string, { resolve: (r: CommandReceipt) => void; timer: ReturnType<typeof setTimeout> }>();
const resourceRoot = () => app.isPackaged ? path.join(process.resourcesPath, 'pet-resources') : path.join(app.getAppPath(), 'resources');
const send = (m: RuntimeMessage) => { if (pet && !pet.isDestroyed()) pet.webContents.send('runtime', m); };
function error(e: unknown) { const message = e instanceof Error ? e.message : String(e); console.error(message); send({ type: 'error', error: message }); }
function trusted(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent, role: 'pet' | 'panel' | 'either' = 'either') {
  const win = BrowserWindow.fromWebContents(event.sender); const valid = role === 'pet' ? win === pet : role === 'panel' ? win === panel : win === pet || win === panel;
  if (!valid || event.senderFrame !== event.sender.mainFrame) throw new Error('IPC_FORBIDDEN');
}
function handle(name: string, role: 'pet' | 'panel' | 'either', fn: (...args: unknown[]) => unknown) { ipcMain.handle(name, (event, ...args: unknown[]) => { trusted(event, role); return fn(...args); }); }
function secureWindow(win: BrowserWindow) { win.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); win.webContents.on('will-navigate', e => e.preventDefault()); win.webContents.on('will-attach-webview', e => e.preventDefault()); win.webContents.session.setPermissionRequestHandler((_wc, _perm, callback) => callback(false)); win.webContents.on('render-process-gone', (_e, info) => { movement = undefined; endDrag(); dialog.showErrorBox('桌宠渲染进程异常', `请从托盘退出并重新启动。${info.reason}`); }); }
function load(win: BrowserWindow, page: string) { if (process.env.ELECTRON_RENDERER_URL && !app.isPackaged) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/?page=${page}`); else void win.loadFile(path.join(__dirname, '../renderer/index.html'), { query: { page } }); }
function openPanel() { if (panel && !panel.isDestroyed()) { panel.show(); panel.focus(); return; } panel = new BrowserWindow({ width: 1040, height: 760, minWidth: 800, minHeight: 620, title: 'DeepBlue · 桌宠小屋', backgroundColor: '#f5f7fc', autoHideMenuBar: true, icon: path.join(resourceRoot(), 'icon.png'), webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } }); secureWindow(panel); panel.on('closed', () => { panel = null; }); load(panel, 'panel'); }
function setIgnore(value: boolean) { if (ignored === value || pet.isDestroyed()) return; ignored = value; pet.setIgnoreMouseEvents(value, { forward: true }); }
function savePosition() { if (!settings) return; void settings.save({ ...settings.value, position: { ...desktop.position } }).catch(error); }
function broadcastDesktop() { send({ type: 'desktop', desktop: { ...desktop } }); }
function place(x: number, y: number, userDrag = false) { const rect = { ...pet.getBounds(), x, y }; const areas = screen.getAllDisplays().map(d => d.workArea); const area = userDrag ? nearestArea(rect, areas) : screen.getDisplayMatching(pet.getBounds()).workArea; const next = clampRect(rect, area); pet.setPosition(next.x, next.y, false); desktop.position = { x: next.x, y: next.y }; }
function resetPosition() { movement = undefined; endDrag(); const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea; const size = dimensions(settings.value.size); place(area.x + area.width - size.width - 24, area.y + area.height - size.height, true); savePosition(); broadcastDesktop(); }
function recoverPosition() { if (!pet || pet.isDestroyed()) return; const bounds = pet.getBounds(); const area = nearestArea(bounds, screen.getAllDisplays().map(d => d.workArea)); const rect = clampRect(bounds, area); place(rect.x, rect.y, true); savePosition(); broadcastDesktop(); }
function updateDragPosition() { if(desktop.dragging && press){const cursor=screen.getCursorScreenPoint();place(press.windowX+cursor.x-press.x,press.windowY+cursor.y-press.y,true);} }
function endDrag() { updateDragPosition(); press = undefined; if (dragTimeout) clearTimeout(dragTimeout); dragTimeout = undefined; if (!desktop.dragging) return; desktop.dragging = false; savePosition(); broadcastDesktop(); }
function samplingState() { if (sampling) clearInterval(sampling); sampling = undefined; if (!desktop.visible || desktop.suspended) return; if (settings.value.clickThrough && !movement && !desktop.dragging) { setIgnore(true); return; }
  sampling = setInterval(() => {
    if (pet.isDestroyed()) return; const cursor = screen.getCursorScreenPoint(); const bounds = pet.getBounds();
    if (desktop.dragging && press) { place(press.windowX + cursor.x - press.x, press.windowY + cursor.y - press.y, true); }
    else if (movement) { const m = movement; const t = Math.min(1, (performance.now() - m.started) / m.ms); const f = ease(t, m.easing); place(m.from.x + (m.to.x - m.from.x) * f, m.from.y + (m.to.y - m.from.y) * f); if (t === 1) { movement = undefined; savePosition(); } }
    const hit = regions.some(r => cursor.x >= bounds.x + r.x && cursor.x <= bounds.x + r.x + r.width && cursor.y >= bounds.y + r.y && cursor.y <= bounds.y + r.y + r.height);
    desktop.pointerNear = regions.some(r => cursor.x >= bounds.x + r.x - 75 && cursor.x <= bounds.x + r.x + r.width + 75 && cursor.y >= bounds.y + r.y - 75 && cursor.y <= bounds.y + r.y + r.height + 75);
    setIgnore(desktop.dragging ? false : settings.value.clickThrough || !hit); broadcastDesktop();
  }, 34);
}
function showPet() { desktop.visible = true; pet.showInactive(); broadcastDesktop(); samplingState(); }
function restoreInteraction() { void applySettings({ ...settings.value, clickThrough: false }).then(showPet).catch(error); }
function menu() { return Menu.buildFromTemplate([{ label: '打开桌宠小屋', click: openPanel }, { label: '恢复交互', click: restoreInteraction }, { label: '显示桌宠', click: showPet }, { label: '隐藏桌宠', click: () => { endDrag(); movement = undefined; desktop.visible = false; pet.hide(); samplingState(); broadcastDesktop(); } }, { label: '重置位置', click: resetPosition }, { type: 'separator' }, { label: settings.value.paused ? '恢复自动行为' : '暂停自动行为', click: () => { void applySettings({ ...settings.value, paused: !settings.value.paused }).catch(error); } }, { label: '退出', click: () => app.quit() }]); }
async function applySettings(raw: unknown) { const next = settingsSchema.parse(raw); await settings.save(next); if (next.fixedPosition) { movement = undefined; endDrag(); } pet.setAlwaysOnTop(next.alwaysOnTop, 'pop-up-menu'); const size = dimensions(next.size); const old = pet.getBounds(); pet.setBounds({ ...old, ...size, y: old.y + old.height - size.height }); recoverPosition(); send({ type: 'settings', settings: settings.value }); panel?.webContents.send('runtime', { type: 'settings', settings: settings.value }); samplingState(); tray?.setContextMenu(menu()); return settings.value; }
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
  const icon = nativeImage.createFromPath(path.join(resourceRoot(), 'icon.png')); if (icon.isEmpty()) throw new Error('无法加载托盘图标'); tray = new Tray(icon.resize({ width: 32, height: 32 })); tray.setToolTip('DeepBlue 桌宠 · 双击打开小屋'); tray.setContextMenu(menu()); tray.on('double-click', openPanel); tray.on('click', openPanel);
  pet.on('ready-to-show', () => { showPet(); }); pet.on('blur', endDrag); pet.on('close', () => app.quit());
  handle('bootstrap', 'either', () => ({ registry: packs.registry, settings: settings.value, desktop, errors: [...packs.errors, ...(settings.error ? [settings.error] : [])] }));
  handle('open-panel', 'either', openPanel); handle('context-menu', 'pet', () => { menu().popup({ window: pet }); }); handle('reset-position', 'either', resetPosition); handle('show-pet', 'either', showPet);
  handle('save-settings', 'panel', applySettings); handle('reset-settings', 'panel', () => applySettings(structuredClone(defaults)));
  handle('open-packs', 'panel', async () => { const e = await shell.openPath(packs.userDir); if (e) throw new Error(e); });
  handle('import-pack', 'panel', importPack); handle('reload-packs', 'panel', async () => { if (importBusy) return { ok: false, message: '正在导入' }; importBusy = true; try { return await reload(); } catch (e) { error(e); return { ok: false, message: String(e) }; } finally { importBusy = false; } });
  const panelRequestSchema = z.discriminatedUnion('type', [z.object({ type: z.literal('command'), command: commandSchema }).strict(), z.object({ type: z.literal('pause'), value: z.boolean() }).strict(), z.object({ type: z.literal('mode'), mode: z.enum(['normal', 'ai']) }).strict()]);
  handle('panel-request', 'panel', raw => requestRuntime({ type: 'request', request: panelRequestSchema.parse(raw) })); handle('get-debug', 'panel', () => debug);
  ipcMain.on('reply', (event, id: unknown, result: unknown) => { try { trusted(event, 'pet'); const key = z.string().uuid().parse(id); const r = z.object({ commandId: z.string(), status: z.enum(['accepted', 'rejected']), actionInstanceId: z.string().optional(), errorCode: z.string().optional(), message: z.string().optional() }).strict().parse(result); const waiter = pending.get(key); if (waiter) { clearTimeout(waiter.timer); pending.delete(key); waiter.resolve(r); } } catch (e) { error(e); } });
  ipcMain.on('publish', (event, state: DebugState) => { try { trusted(event, 'pet'); if (!state || JSON.stringify(state).length > 1000000 || state.snapshot?.snapshotVersion !== 1 || !Array.isArray(state.groups) || !Array.isArray(state.errors)) return; debug = state; panel?.webContents.send('debug', state); } catch (e) { error(e); } });
  ipcMain.on('hit-regions', (event, raw: unknown) => { try { trusted(event, 'pet'); regions = z.array(z.object({ target: z.enum(['head', 'body']), x: z.number().finite().min(-1000).max(2000), y: z.number().finite().min(-1000).max(2000), width: z.number().finite().min(0).max(2000), height: z.number().finite().min(0).max(2000) }).strict()).max(8).parse(raw); } catch (e) { error(e); } });
  handle('pointer-down', 'pet', raw => { const p = z.object({x:z.number().finite(),y:z.number().finite()}).strict().parse(raw); const b = pet.getBounds(); if(!regions.some(r=>p.x>=b.x+r.x-8 && p.x<=b.x+r.x+r.width+8 && p.y>=b.y+r.y-8 && p.y<=b.y+r.y+r.height+8)) throw new Error('POINTER_OUTSIDE_PET'); press = { ...p, windowX: b.x, windowY: b.y, time: Date.now() }; });
  handle('drag-start', 'pet', () => { if (settings.value.fixedPosition || settings.value.clickThrough || !press || Date.now() - press.time > 10000) return false; movement = undefined; desktop.dragging = true; setIgnore(false); updateDragPosition(); dragTimeout = setTimeout(endDrag, 30000); broadcastDesktop(); samplingState(); return true; });
  handle('drag-end', 'pet', endDrag);
  handle('move-start', 'pet', raw => { const m = z.object({ id: z.string().min(1).max(100), dx: z.number().finite().min(-1000).max(1000), dy: z.number().finite().min(-1000).max(1000), ms: z.number().finite().min(1).max(30000), easing: z.enum(['linear', 'easeOut', 'easeInOut']) }).strict().parse(raw); if (settings.value.fixedPosition || desktop.dragging || !desktop.visible) throw new Error('MOVEMENT_LOCKED'); const b = pet.getBounds(); const to = clampRect({ ...b, x: b.x + m.dx, y: b.y + m.dy }, screen.getDisplayMatching(b).workArea); movement = { id: m.id, from: { x: b.x, y: b.y }, to, started: performance.now(), ms: m.ms, easing: m.easing }; samplingState(); });
  handle('move-stop', 'pet', id => { if (movement?.id === id) { movement = undefined; savePosition(); samplingState(); } });
  screen.on('display-added', recoverPosition); screen.on('display-removed', recoverPosition); screen.on('display-metrics-changed', recoverPosition);
  powerMonitor.on('suspend', () => { movement = undefined; endDrag(); desktop.suspended = true; samplingState(); broadcastDesktop(); }); powerMonitor.on('resume', () => { desktop.suspended = false; recoverPosition(); samplingState(); broadcastDesktop(); });
  globalShortcut.register('CommandOrControl+Alt+P', restoreInteraction);
  load(pet, 'pet'); if (process.argv.includes('--panel')) openPanel();
}
if (!app.requestSingleInstanceLock()) app.quit(); else { app.on('second-instance', () => { showPet(); openPanel(); }); void app.whenReady().then(boot).catch(e => { dialog.showErrorBox('DeepBlue 启动失败', String(e)); app.exit(1); }); }
app.on('before-quit', e => { if (quitReady) return; e.preventDefault(); quitReady = true; if (sampling) clearInterval(sampling); if (dragTimeout) clearTimeout(dragTimeout); movement = undefined; globalShortcut.unregisterAll(); for (const p of pending.values()) clearTimeout(p.timer); pending.clear(); if (settings) void settings.save({ ...settings.value, position: desktop.position }).finally(() => app.quit()); else app.quit(); });
app.on('window-all-closed', () => app.quit());





