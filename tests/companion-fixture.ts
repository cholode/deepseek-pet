import { vi } from 'vitest';
import { CompanionStore } from '../src/main/companion/store';
import { CompanionCoordinator } from '../src/companion/coordinator';
import type { CompanionHost, ModelPort, RepositoryPort, ToolPort } from '../src/companion/ports';
import type { Memory } from '../src/shared/companion';

export const now = new Date(2026, 9, 25, 14).getTime();
export function memory(patch: Partial<Memory> = {}): Memory {
  return { id: 'memory-1', text: '一起玩过星露谷', kind: 'episode', factKey: '', scope: 'private', importance: 0.7, pinned: false, createdAt: now, eventAt: now, sourceId: 'test', evidence: '一起玩过星露谷', ...patch };
}
export const assessment = (patch = {}) => ({ text: JSON.stringify({ emotion: 'happy', delta: 3, confidence: 0.9, reason: '收到问候', memories: [], ...patch }), calls: [] });
export function fixture() {
  const data = new CompanionStore('unused', now).data;
  data.config.enabled = true; data.config.model.model = 'fixture';
  const repository: RepositoryPort = { data, save: vi.fn(async () => {}) };
  const model = { complete: vi.fn<ModelPort['complete']>() };
  const tools = { list: vi.fn<ToolPort['list']>(async () => []), call: vi.fn<ToolPort['call']>(async () => '完成'), close: vi.fn(async () => {}) };
  let sequence = 0;
  const host: CompanionHost = { now: () => now, id: () => `event-${++sequence}`, changed: vi.fn(), present: vi.fn(), available: () => true, lastInteractionAt: () => now - 7200000,
    capabilities: () => [{ groupId: 'happy', name: '开心', tags: [], channels: ['face'], expectedDurationMs: 1000, description: '', available: true }] };
  return { data, repository, model, tools, host, coordinator: new CompanionCoordinator(repository, model, tools, host) };
}
