import { ErrorCode } from '@erp/shared';

/**
 * What the assistant knows about a model provider (phase 30). The service, the tools and
 * the tests only see this; each adapter hides its SDK. A new provider is one new adapter
 * and one enum value.
 */
export interface LlmTool {
  name: string;
  description: string;
  /** JSON Schema of the input. */
  inputSchema: Record<string, unknown>;
}

export interface LlmToolCall {
  id: string;
  name: string;
  /** As the model sent it: validated with zod after every call, never trusted. */
  input: unknown;
}

export interface LlmToolResult {
  id: string;
  name: string;
  /** JSON text of the result. */
  content: string;
  isError: boolean;
}

export type LlmMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }
  /** A turn of the current question that called tools. `replay` goes back untouched. */
  | { role: 'assistant_turn'; text: string; toolCalls: LlmToolCall[]; replay: unknown }
  | { role: 'tool_results'; results: LlmToolResult[] };

export interface LlmSystemPrompt {
  /** Same bytes for the same company: the cached prefix. */
  stable: string;
  /** Changes per request. Always after the stable part. */
  dynamic: string;
}

export interface LlmChatRequest {
  system: LlmSystemPrompt;
  messages: LlmMessage[];
  tools: LlmTool[];
  maxOutputTokens: number;
  signal?: AbortSignal;
}

export type LlmStopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';

export interface LlmUsage {
  /** Every input token of the request, the cached ones included. */
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
}

export type LlmErrorCode =
  | typeof ErrorCode.AI_UNAVAILABLE
  | typeof ErrorCode.AI_INVALID_KEY
  | typeof ErrorCode.AI_MODEL_NOT_FOUND
  | typeof ErrorCode.AI_RATE_LIMITED;

export type LlmEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; call: LlmToolCall }
  /** `replay`: whatever the provider needs back next round (thinking, signatures). */
  | { type: 'done'; stopReason: LlmStopReason; usage: LlmUsage; replay: unknown }
  | { type: 'error'; code: LlmErrorCode };

export interface LlmProvider {
  chat(request: LlmChatRequest): AsyncIterable<LlmEvent>;
}

/** Provider errors become one of our codes; their message never travels further. */
export function errorCodeOf(err: unknown): LlmErrorCode {
  const status = (err as { status?: unknown } | null)?.status;
  if (status === 401 || status === 403) return ErrorCode.AI_INVALID_KEY;
  if (status === 404) return ErrorCode.AI_MODEL_NOT_FOUND;
  if (status === 429) return ErrorCode.AI_RATE_LIMITED;
  return ErrorCode.AI_UNAVAILABLE;
}

export const LLM_TIMEOUT_MS = 60_000;
