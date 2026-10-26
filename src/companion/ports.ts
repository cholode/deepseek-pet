import type { CompanionConfig, CompanionData, CompanionPresentation, CompanionView } from '../shared/companion';
import type { GroupCapability } from '../shared/contracts';
// 所有外部能力走端口注入，领域逻辑可在无 Electron、无网络的环境中测试。
export interface ChatMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_call_id?: string; tool_calls?: ToolCall[] }
export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface ToolDefinition { name: string; description: string; inputSchema: Record<string, unknown> }
export interface ModelPort { complete(messages: ChatMessage[], config: CompanionConfig['model'], signal: AbortSignal, tools?: ToolDefinition[], onText?: (delta: string) => void): Promise<{ text: string; calls: ToolCall[] }> }
export interface ToolPort { list(signal: AbortSignal): Promise<ToolDefinition[]>; call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<string>; close(): Promise<void> }
export interface RepositoryPort { data: CompanionData; save(): Promise<void> }
export interface CompanionHost {
  now(): number; id(): string; changed(view: CompanionView): void; present(presentation: CompanionPresentation | null): void;
  capabilities(): GroupCapability[]; available(): boolean; lastInteractionAt(): number;
}
