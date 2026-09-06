import { analyze, type ActionNode, type Catalog, type GroupInfo, type Motion } from '../../shared/schema';
export type Leaf = Exclude<ActionNode, { type: 'sequence' | 'parallel' }>;
export interface RunningLeaf { update(elapsedMs: number): void; dispose(): void }
export interface AnimationHost { begin(node: Leaf, catalog: Catalog, source: string, instanceId: string): RunningLeaf; reset(): void }
interface Scheduled { node: Leaf; start: number; end: number; handle?: RunningLeaf; finished: boolean }
export function schedule(node: ActionNode, catalog: Catalog, offset = 0): Scheduled[] {
  if (node.type === 'sequence') { const out: Scheduled[] = []; let time = offset; for (const child of node.children) { out.push(...schedule(child, catalog, time)); time += analyze(child, catalog.motions).duration; } return out; }
  if (node.type === 'parallel') return node.children.flatMap(child => schedule(child, catalog, offset));
  return [{ node: node as Leaf, start: offset, end: offset + analyze(node, catalog.motions).duration, finished: false }];
}
export class ActionGroupRunner {
  private leaves: Scheduled[]; private ended = false; elapsedMs = 0;
  constructor(readonly group: GroupInfo, readonly instanceId: string, readonly source: string, private catalog: Catalog, private host: AnimationHost, private done: (status: 'completed' | 'cancelled' | 'failed', error?: string) => void) { this.leaves = schedule(group.timeline, catalog); }
  tick(deltaMs: number) {
    if (this.ended) return; this.elapsedMs += deltaMs;
    if (this.elapsedMs > this.group.maxDurationMs) { this.finish('failed', 'ACTION_TIMEOUT'); return; }
    try {
      // Release ending channels before starting the next sequential node at the same timestamp.
      for (const leaf of this.leaves) if (leaf.handle && !leaf.finished && this.elapsedMs >= leaf.end) { leaf.handle.update(leaf.end - leaf.start); leaf.handle.dispose(); leaf.finished = true; }
      for (const leaf of this.leaves) {
        if (leaf.finished || this.elapsedMs < leaf.start) continue;
        leaf.handle ??= this.host.begin(leaf.node, this.catalog, this.source, this.instanceId);
        leaf.handle.update(Math.min(this.elapsedMs, leaf.end) - leaf.start);
        if (this.elapsedMs >= leaf.end) { leaf.handle.dispose(); leaf.finished = true; }
      }
      if (this.leaves.every(l => l.finished)) this.finish('completed');
    } catch (e) { this.finish('failed', e instanceof Error ? e.message : String(e)); }
  }
  cancel() { this.finish('cancelled'); }
  fail(error: string) { this.finish('failed', error); }
  private finish(status: 'completed' | 'cancelled' | 'failed', error?: string) {
    if (this.ended) return; this.ended = true;
    for (const l of this.leaves) if (!l.finished) { try { l.handle?.dispose(); } catch { /* Continue releasing sibling resources. */ } l.finished = true; }
    try { this.host.reset(); } finally { this.done(status, error); }
  }
}
export function frameIndex(m: Extract<Motion, { kind: 'frame_animation' }>, time: number): number { let end = 0; for (let i = 0; i < m.frames.length; i++) { end += m.fps ? 1000 / m.fps : m.frameDurationsMs![i]; if (time < end) return i; } return m.frames.length - 1; }
