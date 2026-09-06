import { effective, type GroupInfo, type Settings } from '../../shared/schema';
import type { BehaviorContext, DriverStatus, IBehaviorDriver, PetEvent } from '../../shared/contracts';
export interface Clock { now(): number; setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout>; clearTimeout(id: ReturnType<typeof setTimeout>): void }
export const realClock: Clock = { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id) };
export interface SelectionState { settings: Settings; lastInteraction: number; pointerNear: boolean; cooldowns: Map<string, number>; history: string[]; quarantined: Set<string> }
export function candidates(groups: GroupInfo[], state: SelectionState, now: number): GroupInfo[] {
  const s = state.settings;
  const base = groups.map(g => effective(g, s)).filter(g => g.enabled && g.random.eligible && g.random.weight > 0 && !state.quarantined.has(g.groupId) && (!g.channels.includes('movement') || !s.fixedPosition) && now - (state.cooldowns.get(g.groupId) ?? -Infinity) >= g.random.cooldownMs && now - state.lastInteraction >= g.conditions.minIdleMs && (!g.conditions.requiresRoaming || s.roaming) && (!g.channels.includes('movement') || s.roaming) && (!g.conditions.requiresPointerAway || !state.pointerNear));
  let history = state.history.slice(-2); let pool = base.filter(g => !history.includes(g.groupId));
  while (!pool.length && history.length) { history = history.slice(1); pool = base.filter(g => !history.includes(g.groupId)); }
  return pool;
}
export function weighted(pool: GroupInfo[], random: () => number): GroupInfo | undefined { const total = pool.reduce((a, g) => a + g.random.weight, 0); if (total <= 0) return; let point = Math.min(0.999999999, Math.max(0, random())) * total; for (const g of pool) { point -= g.random.weight; if (point < 0) return g; } return pool.at(-1); }
export class NormalBehaviorDriver implements IBehaviorDriver {
  readonly mode = 'normal' as const; status: DriverStatus = 'stopped'; private context?: BehaviorContext; private timer?: ReturnType<typeof setTimeout>; private epoch = 0; private unsubscribe?: () => void; candidateCount = 0; nextAt = 0; history: string[] = []; cooldowns = new Map<string, number>();
  constructor(private groups: () => GroupInfo[], private state: () => Omit<SelectionState, 'cooldowns' | 'history'>, private random = Math.random, private clock: Clock = realClock) {}
  async start(context: BehaviorContext) { await this.stop(); this.context = context; this.unsubscribe = context.subscribe(e => this.onEvent(e)); this.status = 'running'; this.arm(); }
  pause() { this.status = 'paused'; this.clear(); }
  resume() { if (this.status === 'running') return; this.status = 'running'; this.arm(); }
  async stop() { this.status = 'stopped'; this.clear(); this.unsubscribe?.(); this.unsubscribe = undefined; }
  private clear() { this.epoch++; if (this.timer !== undefined) this.clock.clearTimeout(this.timer); this.timer = undefined; this.nextAt = 0; }
  private onEvent(event: PetEvent) {
    if (event.type === 'action_lifecycle') { const p = event.payload; if (p.status === 'started') { this.clear(); if (p.source === 'normal') this.history = [...this.history, p.groupId].slice(-2); } else { this.cooldowns.set(p.groupId, this.clock.now()); this.arm(); } }
    if (event.type === 'interaction') this.arm();
  }
  refresh() { this.arm(); }
  private arm() {
    this.clear(); if (this.status !== 'running' || !this.context) return;
    const snapshot = this.context.control.getSnapshot(); if (!snapshot.visible || snapshot.dragging || snapshot.currentAction) return;
    const { settings } = this.state(); const delay = settings.intervalMinMs + this.random() * (settings.intervalMaxMs - settings.intervalMinMs); const epoch = this.epoch; this.nextAt = this.clock.now() + delay;
    this.timer = this.clock.setTimeout(() => { this.timer = undefined; this.nextAt = 0; if (epoch !== this.epoch || this.status !== 'running' || !this.context) return; const current = this.context.control.getSnapshot(); if (!current.visible || current.dragging || current.currentAction) { this.arm(); return; }
      const pool = candidates(this.groups(), { ...this.state(), cooldowns: this.cooldowns, history: this.history }, this.clock.now()); this.candidateCount = pool.length; const group = weighted(pool, this.random);
      if (!group) { this.arm(); return; }
      void this.context.control.submit({ protocolVersion: 1, commandId: `normal-${this.clock.now()}-${epoch}`, type: 'play_group', groupId: group.groupId }).then(r => { if (epoch === this.epoch && r.status === 'rejected') this.arm(); }).catch(() => { if (epoch === this.epoch) this.arm(); });
    }, delay);
  }
}
export function checkMode(mode: 'normal' | 'ai') { return mode === 'normal' ? { available: true as const } : { available: false as const, errorCode: 'MODE_NOT_AVAILABLE', message: 'AI 模式开发中，当前版本不可用' }; }
