import { z } from 'zod';
import { globalId, type Registry, type Settings, type GroupInfo, type ActionChannel } from './schema';
export type PetMode = 'normal' | 'ai';
export type DriverStatus = 'stopped' | 'running' | 'paused' | 'unavailable';
export type CommandSource = 'normal' | 'interaction' | 'manual' | 'ai' | 'system';
const base = { protocolVersion: z.literal(1), commandId: z.string().min(1).max(100) };
export const commandSchema = z.discriminatedUnion('type', [z.object({ ...base, type: z.literal('play_group'), groupId: globalId, expiresAtUnixMs: z.number().finite().optional() }).strict(), z.object({ ...base, type: z.literal('stop_current') }).strict(), z.object({ ...base, type: z.literal('reset_pose') }).strict()]);
export type PetCommand = z.infer<typeof commandSchema>;
export interface CommandReceipt { commandId: string; status: 'accepted' | 'rejected'; actionInstanceId?: string; errorCode?: string; message?: string }
export interface GroupCapability { groupId: string; name: string; description: string; tags: readonly string[]; channels: readonly ActionChannel[]; expectedDurationMs: number; available: boolean; unavailableReason?: string }
export interface PetSnapshot { snapshotVersion: 1; mode: PetMode; driverStatus: DriverStatus; avatarId: string; registryRevision: number; visible: boolean; dragging: boolean; fixedPosition: boolean; windowPositionDip: { x: number; y: number }; currentAction: null | { actionInstanceId: string; groupId: string; source: CommandSource; elapsedMs: number } }
export type PetEvent = { type: 'interaction'; occurredAtUnixMs: number; payload: { target: 'head' | 'body' | 'desktop'; gesture: 'click' | 'drag-start' | 'drag-end'; clickCount: number } } | { type: 'action_lifecycle'; occurredAtUnixMs: number; payload: { actionInstanceId: string; groupId: string; source: CommandSource; status: 'started' | 'completed' | 'cancelled' | 'failed'; error?: string } } | { type: 'runtime_changed'; occurredAtUnixMs: number; payload: { revision: number } };
export interface PetControlPort { getSnapshot(): PetSnapshot; listCapabilities(): readonly GroupCapability[]; submit(command: PetCommand): Promise<CommandReceipt> }
export interface BehaviorContext { control: PetControlPort; subscribe(listener: (event: PetEvent) => void): () => void }
export interface IBehaviorDriver { readonly mode: PetMode; readonly status: DriverStatus; start(context: BehaviorContext): Promise<void>; pause(): void; resume(): void; stop(): Promise<void> }
export interface DesktopState { visible: boolean; dragging: boolean; pointerNear: boolean; position: { x: number; y: number }; suspended: boolean }
export interface DebugState { failedGroups: string[]; snapshot: PetSnapshot; groups: GroupInfo[]; errors: string[]; candidateCount: number; nextInMs: number; events: PetEvent[] }
export interface Bootstrap { registry: Registry; settings: Settings; desktop: DesktopState; errors: string[] }
export type PanelRequest = { type: 'command'; command: PetCommand } | { type: 'pause'; value: boolean } | { type: 'mode'; mode: PetMode };
export type RuntimeMessage = { type: 'settings'; settings: Settings } | { type: 'desktop'; desktop: DesktopState } | { type: 'registry'; registry: Registry; requestId: string } | { type: 'request'; request: PanelRequest; requestId: string } | { type: 'error'; error: string };
export interface HitRegion { target: 'head' | 'body'; x: number; y: number; width: number; height: number }
export interface PetBridge {
  bootstrap(): Promise<Bootstrap>; openPanel(): Promise<void>; contextMenu(): Promise<void>; resetPosition(): Promise<void>; showPet(): Promise<void>;
  saveSettings(settings: Settings): Promise<Settings>; resetSettings(): Promise<Settings>; importPack(): Promise<{ ok: boolean; message: string }>; reloadPacks(): Promise<{ ok: boolean; message: string }>; openPacksFolder(): Promise<void>;
  panelRequest(request: PanelRequest): Promise<CommandReceipt>; getDebug(): Promise<DebugState | null>;
  publish(state: DebugState): void; reply(requestId: string, result: CommandReceipt): void; onMessage(fn: (m: RuntimeMessage) => void): () => void; onDebug(fn: (s: DebugState) => void): () => void;
  hitRegions(regions: HitRegion[]): void; pointerDown(point: { x: number; y: number }): Promise<void>; dragStart(): Promise<boolean>; dragEnd(): Promise<void>;
  moveStart(id: string, dx: number, dy: number, duration: number, easing: string): Promise<void>; moveStop(id: string): Promise<void>;
}
declare global { interface Window { pet: PetBridge } }


