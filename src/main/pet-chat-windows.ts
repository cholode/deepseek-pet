import { BrowserWindow, screen, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import type { CompanionPresentation, CompanionView } from '../shared/companion';
import type { QuickChatState, QuickChatTab, QuickPetStatus, SpeechBubbleState } from '../shared/pet-chat';
import { chatAnchors, inputBarLayout, quickPanelSize, speechBubbleLayout, HoverChatPolicy } from '../shared/chat-layout';
import type { HitRegion } from '../shared/contracts';
import type { Rect } from '../shared/geometry';

interface Host {
  pet(): BrowserWindow; preload: string;
  secure(window: BrowserWindow): void; load(window: BrowserWindow, page: string): void;
  visible(): boolean; alwaysOnTop(): boolean; activity(open: boolean): void;
  regions(): readonly HitRegion[]; movePet(x: number, y: number): void;
  status(): QuickPetStatus;
}
export class PetChatWindows {
  private chat?: BrowserWindow; private bubble?: BrowserWindow;
  private chatLoaded = false; private bubbleLoaded = false; private held = false;
  private policy = new HoverChatPolicy(); private active = false;
  private bubbleSize = { width: 230, height: 92 }; private bubbleTimer?: ReturnType<typeof setTimeout>;
  private speech: SpeechBubbleState | null = null;
  private lifted?: { from: Rect; to: Rect };
  private current: QuickChatState = { name: '大肥鱼', ready: false, busy: false, reply: '', streaming: false, tab: 'chat', status: null };
  constructor(private host: Host) {}
  isSender(event: IpcMainEvent | IpcMainInvokeEvent, kind: 'chat' | 'bubble') {
    const window = kind === 'chat' ? this.chat : this.bubble;
    return Boolean(window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === event.sender.mainFrame);
  }
  state() { return { ...this.current, status: this.host.status() }; }
  refreshStatus() {
    const status = this.host.status();
    if (JSON.stringify(status) === JSON.stringify(this.current.status)) return;
    this.current.status = status; this.chat?.webContents.send('quick-chat-state', this.current);
  }
  selectTab(tab: QuickChatTab) {
    if (this.current.tab === tab) return;
    this.current.tab = tab;
    // 从高卡片切回短输入条时只撤销本窗口造成的上移，保留用户后来调整的位置。
    this.restorePosition(); this.align();
    this.chat?.webContents.send('quick-chat-state', this.state());
  }
  bubbleState() { return this.speech; }
  hold(value: boolean) { this.held = value; }
  dismiss() { this.policy.dismiss(); this.chat?.hide(); this.restorePosition(); this.setActivity(false); }
  private restorePosition() {
    const lifted = this.lifted; this.lifted = undefined;
    const pet = this.host.pet(); if (!lifted || pet.isDestroyed()) return;
    const current = pet.getBounds();
    // 用户已经拖走或改过角色尺寸时，不能再跳回旧位置。
    if (Object.entries(lifted.to).every(([key, value]) => current[key as keyof Rect] === value)) this.host.movePet(lifted.from.x, lifted.from.y);
  }
  private setActivity(value: boolean) { if (value !== this.active) { this.active = value; this.host.activity(value); } }
  update(view: CompanionView) {
    const reply = [...view.data.events].reverse().find(e => e.actor === 'pet' && e.conversationId === 'desktop')?.text ?? '';
    this.current = { ...this.current, name: view.data.config.persona.name, ready: view.ready, busy: view.busy, error: view.error, reply: this.current.streaming ? this.current.reply : reply, status: this.host.status() };
    this.chat?.webContents.send('quick-chat-state', this.current);
  }
  private create(kind: 'chat' | 'bubble') {
    const size = kind === 'chat' ? quickPanelSize(this.current.tab) : this.bubbleSize;
    const window = new BrowserWindow({ width: size.width, height: size.height,
      show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false,
      maximizable: false, minimizable: false, skipTaskbar: true, focusable: kind === 'chat', title: kind === 'chat' ? '大肥鱼 · 悬停聊天' : '大肥鱼 · 聊天气泡',
      webPreferences: { preload: this.host.preload, contextIsolation: true, sandbox: true, nodeIntegration: false } });
    this.host.secure(window); window.setAlwaysOnTop(this.host.alwaysOnTop(), 'pop-up-menu');
    if (kind === 'bubble') { window.setIgnoreMouseEvents(true); this.bubble = window; }
    else { this.chat = window; window.on('close', e => { e.preventDefault(); this.dismiss(); }); }
    window.webContents.on('did-finish-load', () => {
      if (kind === 'chat') { this.chatLoaded = true; window.webContents.send('quick-chat-state', this.state()); }
      else { this.bubbleLoaded = true; window.webContents.send('speech-bubble', this.speech); }
      this.align();
    });
    this.host.load(window, kind === 'chat' ? 'quick-chat' : 'speech-bubble');
    return window;
  }
  sample(cursor: { x: number; y: number }, overPet: boolean, blocked: boolean) {
    const bounds = this.chat?.isVisible() ? this.chat.getBounds() : undefined;
    const overChat = Boolean(bounds && cursor.x >= bounds.x && cursor.x <= bounds.x + bounds.width && cursor.y >= bounds.y && cursor.y <= bounds.y + bounds.height);
    const open = this.policy.update(Date.now(), overPet, overChat, this.held || this.current.busy || Boolean(this.chat?.isFocused()), blocked);
    if (open) { this.chat ??= this.create('chat'); this.align(); if (this.chatLoaded && !this.chat.isVisible()) this.chat.showInactive(); }
    else { this.chat?.hide(); if (blocked && !this.host.visible()) this.lifted = undefined; else this.restorePosition(); }
    this.setActivity(open); this.align();
  }
  suspend() { this.policy.update(Date.now(), false, false, false, true); this.chat?.hide(); this.bubble?.hide(); this.restorePosition(); this.setActivity(false); }
  present(value: CompanionPresentation | null, bubbles: boolean) {
    if (value?.phase === 'action') return;
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
    if (!value) { this.speech = null; this.current.streaming = false; this.bubble?.hide(); this.chat?.webContents.send('quick-chat-state', this.current); return; }
    this.current.reply = value.text; this.current.streaming = value.phase === 'streaming';
    this.chat?.webContents.send('quick-chat-state', this.current);
    if (!bubbles) { this.speech = null; this.bubble?.hide(); return; }
    this.speech = { text: value.text, streaming: value.phase === 'streaming' };
    this.bubble ??= this.create('bubble'); this.align(); this.bubble.webContents.send('speech-bubble', this.speech);
    // 正在输出时不消失；完成后按阅读长度留足时间，长回复可在小屋查看。
    if (value.phase !== 'streaming') this.bubbleTimer = setTimeout(() => { this.speech = null; this.bubble?.hide(); }, Math.min(60000, Math.max(12000, value.text.length * 160)));
  }
  resizeBubble(size: { width: number; height: number }) { this.bubbleSize = size; this.align(); }
  align() {
    const pet = this.host.pet(); if (pet.isDestroyed()) return;
    let bounds = pet.getBounds(); const area = screen.getDisplayMatching(bounds).workArea;
    // 托盘重置位置、角色缩放等入口也会改窗口，不能沿用先前的恢复坐标。
    if (this.lifted && Object.entries(this.lifted.to).some(([key, value]) => bounds[key as keyof Rect] !== value)) this.lifted = undefined;
    let anchor = chatAnchors(bounds, this.host.regions());
    if (this.chat && this.policy.open && this.host.visible()) {
      const lift = Math.min(inputBarLayout(anchor, area, this.current.tab).lift, Math.max(0, bounds.y - area.y));
      if (lift > 0) {
        const from = this.lifted?.from ?? bounds; this.host.movePet(bounds.x, bounds.y - lift);
        bounds = pet.getBounds(); this.lifted = { from, to: bounds }; anchor = chatAnchors(bounds, this.host.regions());
      }
    }
    if (!this.host.visible()) this.bubble?.hide();
    const layout = this.speech ? speechBubbleLayout(anchor, this.bubbleSize, area) : undefined;
    const place = (window: BrowserWindow, bounds: Electron.Rectangle) => {
      const old = window.getBounds();
      if (old.x !== bounds.x || old.y !== bounds.y || old.width !== bounds.width || old.height !== bounds.height) window.setBounds(bounds, false);
    };
    if (this.bubble && layout && this.speech) {
      place(this.bubble, layout.bounds);
      if (layout.tail.side !== this.speech.tail?.side || layout.tail.offset !== this.speech.tail?.offset) {
        this.speech = { ...this.speech, tail: layout.tail }; this.bubble.webContents.send('speech-bubble', this.speech);
      }
      if (this.bubbleLoaded && this.host.visible() && !this.bubble.isVisible()) this.bubble.showInactive();
    }
    if (this.chat && this.policy.open) place(this.chat, inputBarLayout(anchor, area, this.current.tab).bounds);
  }
  topmost(value: boolean) { this.chat?.setAlwaysOnTop(value, 'pop-up-menu'); this.bubble?.setAlwaysOnTop(value, 'pop-up-menu'); }
  hideSpeech() { this.speech = null; this.bubble?.hide(); }
  dispose() { if (this.bubbleTimer) clearTimeout(this.bubbleTimer); this.restorePosition(); this.chat?.destroy(); this.bubble?.destroy(); this.chat = undefined; this.bubble = undefined; }
}
