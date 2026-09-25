import { AVATAR, effective, makeCatalog, type Catalog, type Registry, type Settings } from '../../shared/schema';
import { commandSchema, type CommandSource, type CommandReceipt, type PetControlPort, type PetEvent, type PetSnapshot, type DesktopState, type DebugState } from '../../shared/contracts';
import { ActionGroupRunner, type AnimationHost } from './engine';
import { NormalBehaviorDriver, checkMode } from './behavior';
const priorities: Record<CommandSource, number> = { system: 100, manual: 80, interaction: 60, ai: 40, normal: 10 };
export class PetRuntime {
  catalog: Catalog; readonly driver: NormalBehaviorDriver; current: ActionGroupRunner | null = null; lastInteraction = Date.now(); quarantined = new Set<string>(); errors: string[] = []; events: PetEvent[] = []; private listeners = new Set<(e: PetEvent) => void>(); private serial = 0; private cache = new Map<string, { content: string; result: CommandReceipt }>(); private lastSubmit = new Map<CommandSource, number>();
  constructor(public registry: Registry, public settings: Settings, public desktop: DesktopState, private host: AnimationHost) {
    this.catalog = makeCatalog(registry); this.driver = new NormalBehaviorDriver(() => [...this.catalog.groups.values()], () => ({ settings: this.settings, lastInteraction: this.lastInteraction, pointerNear: this.desktop.pointerNear, quarantined: this.quarantined }));
  }
  async start() { await this.driver.start({ control: this.port('normal'), subscribe: f => this.subscribe(f) }); this.syncDriver(); }
  subscribe(f: (e: PetEvent) => void) { this.listeners.add(f); return () => { this.listeners.delete(f); }; }
  private emit(e: PetEvent) { this.events = [...this.events, e].slice(-60); for (const fn of this.listeners) fn(e); }
  log(message: string) { this.errors = [...this.errors, message].slice(-40); }
  snapshot(): PetSnapshot { return { snapshotVersion: 1, mode: 'normal', driverStatus: this.driver.status, avatarId: AVATAR, registryRevision: this.registry.revision, visible: this.desktop.visible, dragging: this.desktop.dragging, fixedPosition: this.settings.fixedPosition, windowPositionDip: this.desktop.position, currentAction: this.current ? { actionInstanceId: this.current.instanceId, groupId: this.current.group.groupId, source: this.current.source as CommandSource, elapsedMs: this.current.elapsedMs } : null }; }
  debug(): DebugState { return { failedGroups: [...this.quarantined], snapshot: this.snapshot(), groups: [...this.catalog.groups.values()].map(g => effective(g, this.settings)), errors: this.errors, events: this.events, candidateCount: this.driver.candidateCount, nextInMs: Math.max(0, this.driver.nextAt - Date.now()) }; }
  port(source: CommandSource): PetControlPort { return { getSnapshot: () => this.snapshot(), listCapabilities: () => [...this.catalog.groups.values()].map(raw => { const g = effective(raw, this.settings); const reason = !g.enabled ? '动作已禁用' : this.quarantined.has(g.groupId) ? '动作故障，请重新加载' : this.settings.fixedPosition && g.channels.includes('movement') ? '已固定位置' : undefined; return { groupId: g.groupId, name: g.name, description: g.description, tags: g.tags, channels: g.channels, expectedDurationMs: g.expectedDurationMs, available: !reason, unavailableReason: reason }; }), submit: async command => this.submit(command, source) }; }
  submit(raw: unknown, source: CommandSource): CommandReceipt {
    const parsed = commandSchema.safeParse(raw); if (!parsed.success) return { commandId: '', status: 'rejected', errorCode: 'INVALID_COMMAND', message: parsed.error.message };
    const c = parsed.data; const key = `${source}:${c.commandId}`; const content = JSON.stringify(c); const previous = this.cache.get(key);
    if (previous) return previous.content === content ? previous.result : { commandId: c.commandId, status: 'rejected', errorCode: 'COMMAND_ID_CONFLICT' };
    const reject = (errorCode: string, message = errorCode): CommandReceipt => ({ commandId: c.commandId, status: 'rejected', errorCode, message });
    let result: CommandReceipt;
    if (source === 'ai') result = reject('MODE_NOT_AVAILABLE', 'AI 模式开发中');
    else if (c.type === 'play_group' && c.expiresAtUnixMs !== undefined && c.expiresAtUnixMs <= Date.now()) result = reject('COMMAND_EXPIRED');
    else if (this.desktop.dragging && source !== 'system') result = reject('DRAG_LOCKED', '拖动中，请先松开鼠标');
    else if (this.current && priorities[source] < priorities[this.current.source as CommandSource]) result = reject('BUSY', '有更高优先级的动作正在运行');
    else if (c.type !== 'play_group') { this.current?.cancel(); this.host.reset(); result = { commandId: c.commandId, status: 'accepted' }; }
    else {
      const rawGroup = this.catalog.groups.get(c.groupId); const g = rawGroup ? effective(rawGroup, this.settings) : undefined;
      if (!g) result = reject('UNKNOWN_GROUP', '找不到动作组');
      else if (!g.enabled || this.quarantined.has(c.groupId)) result = reject('GROUP_UNAVAILABLE', '动作被禁用或发生故障');
      else if (!this.desktop.visible || this.desktop.suspended) result = reject('NOT_VISIBLE');
      else if (g.conditions.requiresStanding && this.current) result = reject('REQUIRES_STANDING', '请等当前动作结束、回到站立待机后再睡觉');
      else if (this.settings.fixedPosition && g.channels.includes('movement')) result = reject('FIXED_POSITION', '关闭固定位置后才能播放移动动作');
      else if (Date.now() - (this.lastSubmit.get(source) ?? 0) < 90 && source !== 'system') result = reject('RATE_LIMITED', '操作太快，请稍候');
      else {
        this.current?.cancel(); const id = `action-${Date.now()}-${++this.serial}`; this.lastSubmit.set(source, Date.now());
        const runner = new ActionGroupRunner(g, id, source, this.catalog, this.host, (status, error) => { if (this.current?.instanceId !== id) return; this.current = null; if (status === 'failed') { this.quarantined.add(g.groupId); this.log(`${g.name}: ${error}`); } this.emit({ type: 'action_lifecycle', occurredAtUnixMs: Date.now(), payload: { actionInstanceId: id, groupId: g.groupId, source, status, error } }); });
        this.current = runner; this.emit({ type: 'action_lifecycle', occurredAtUnixMs: Date.now(), payload: { actionInstanceId: id, groupId: g.groupId, source, status: 'started' } }); runner.tick(0); result = { commandId: c.commandId, status: 'accepted', actionInstanceId: id };
      }
    }
    this.cache.set(key, { content, result }); if (this.cache.size > 256) this.cache.delete(this.cache.keys().next().value!); return result;
  }
  tick(delta: number) { if (delta > 1500) { this.current?.cancel(); this.host.reset(); this.driver.refresh(); return; } this.current?.tick(Math.min(100, delta)); }
  setMode(mode: 'normal' | 'ai') { return checkMode(mode); }
  setSettings(settings: Settings) { if (settings.fixedPosition && this.current?.group.channels.includes('movement')) this.current.cancel(); this.settings = settings; this.syncDriver(); }
  private syncDriver() { if (this.settings.paused || !this.desktop.visible || this.desktop.dragging || this.desktop.suspended) this.driver.pause(); else { this.driver.resume(); this.driver.refresh(); } }
  setDesktop(desktop: DesktopState) { const previous = this.desktop; this.desktop = desktop; if ((!desktop.visible || desktop.suspended || desktop.dragging) && this.current) this.current.cancel();
    if (previous.dragging !== desktop.dragging) { this.interact('desktop', desktop.dragging ? 'drag-start' : 'drag-end'); if (!desktop.dragging && desktop.visible && !desktop.suspended) this.play('builtin.deepblue:drag_release', 'system'); }
    if (previous.visible !== desktop.visible || previous.dragging !== desktop.dragging || previous.suspended !== desktop.suspended) this.syncDriver();
  }
  interact(target: 'head' | 'body' | 'desktop', gesture: 'click' | 'drag-start' | 'drag-end' = 'click') { this.lastInteraction = Date.now(); this.emit({ type: 'interaction', occurredAtUnixMs: Date.now(), payload: { target, gesture, clickCount: gesture === 'click' ? 1 : 0 } }); }
  play(groupId: string, source: CommandSource) { return this.submit({ protocolVersion: 1, commandId: `local-${++this.serial}-${Date.now()}`, type: 'play_group', groupId }, source); }
  replaceRegistry(next: Registry) { const catalog = makeCatalog(next); this.current?.cancel(); this.catalog = catalog; this.registry = next; this.quarantined.clear(); this.emit({ type: 'runtime_changed', occurredAtUnixMs: Date.now(), payload: { revision: next.revision } }); this.driver.refresh(); }
  async dispose() { await this.driver.stop(); this.current?.cancel(); this.listeners.clear(); this.cache.clear(); }
}

