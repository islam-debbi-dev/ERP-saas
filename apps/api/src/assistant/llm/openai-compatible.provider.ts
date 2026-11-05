import type { OpenAI } from 'openai';
import {
  errorCodeOf,
  LLM_TIMEOUT_MS,
  type LlmChatRequest,
  type LlmEvent,
  type LlmMessage,
  type LlmProvider,
  type LlmStopReason,
  type LlmTool,
} from './llm-provider';
import { strictSchema } from './tool-schemas';

type ChatParams = OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming;
type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ChatTool = OpenAI.Chat.Completions.ChatCompletionFunctionTool;
type ChatChunk = OpenAI.Chat.Completions.ChatCompletionChunk;

/** OpenAI itself: the only host here sure to know `strict` and `max_completion_tokens`. */
function isOpenAi(baseUrl: string | null): boolean {
  return baseUrl === null || new URL(baseUrl).hostname === 'api.openai.com';
}

export function openAiTools(tools: LlmTool[], strict: boolean): ChatTool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: strict ? strictSchema(tool.inputSchema) : tool.inputSchema,
      ...(strict ? { strict: true } : {}),
    },
  }));
}

function openAiMessages(messages: LlmMessage[]): ChatMessage[] {
  return messages.flatMap((m): ChatMessage[] => {
    switch (m.role) {
      case 'user':
      case 'assistant':
        return [{ role: m.role, content: m.content }];
      case 'assistant_turn':
        return [
          {
            role: 'assistant',
            content: m.text || null,
            tool_calls: m.toolCalls.map((call) => ({
              id: call.id,
              type: 'function' as const,
              function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) },
            })),
          },
        ];
      case 'tool_results':
        return m.results.map((r) => ({ role: 'tool', tool_call_id: r.id, content: r.content }));
    }
  });
}

export function openAiRequest(
  model: string,
  baseUrl: string | null,
  request: LlmChatRequest,
): ChatParams {
  const official = isOpenAi(baseUrl);
  return {
    model,
    stream: true,
    stream_options: { include_usage: true },
    // One message, stable text first: servers that cache match on the prefix, and not
    // every OpenAI-compatible server takes two system messages.
    messages: [
      { role: 'system', content: `${request.system.stable}\n\n${request.system.dynamic}` },
      ...openAiMessages(request.messages),
    ],
    ...(request.tools.length > 0 ? { tools: openAiTools(request.tools, official) } : {}),
    ...(official
      ? { max_completion_tokens: request.maxOutputTokens }
      : { max_tokens: request.maxOutputTokens }),
  };
}

function stopReason(reason: string | null, calls: number): LlmStopReason {
  switch (reason) {
    case 'stop':
      return calls > 0 ? 'tool_use' : 'end_turn';
    case 'tool_calls':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'refusal';
    default:
      return 'other';
  }
}

/** A model may send broken JSON: zod then refuses `undefined` and it gets INVALID_INPUT. */
function parseArguments(text: string): unknown {
  try {
    return text === '' ? {} : (JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

/** The chunks as normalized events. Pure, so recorded fixtures can drive it. */
export async function* openAiEvents(chunks: AsyncIterable<ChatChunk>): AsyncGenerator<LlmEvent> {
  const calls = new Map<number, { id: string; name: string; args: string }>();
  let finishReason: string | null = null;
  let usage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };

  for await (const chunk of chunks) {
    const choice = chunk.choices[0];
    if (choice?.delta.content) yield { type: 'text', delta: choice.delta.content };
    for (const part of choice?.delta.tool_calls ?? []) {
      const call = calls.get(part.index) ?? { id: '', name: '', args: '' };
      call.id = part.id ?? call.id;
      call.name = part.function?.name ?? call.name;
      call.args += part.function?.arguments ?? '';
      calls.set(part.index, call);
    }
    finishReason = choice?.finish_reason ?? finishReason;
    if (chunk.usage) {
      usage = {
        inputTokens: chunk.usage.prompt_tokens,
        cachedTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
        outputTokens: chunk.usage.completion_tokens,
      };
    }
  }

  for (const call of calls.values()) {
    yield {
      type: 'tool_call',
      call: { id: call.id, name: call.name, input: parseArguments(call.args) },
    };
  }
  yield { type: 'done', stopReason: stopReason(finishReason, calls.size), usage, replay: null };
}

/** OpenAI, Mistral, DeepSeek, OpenRouter, Groq, a local Ollama: one adapter, a base URL. */
export class OpenAiCompatibleProvider implements LlmProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl: string | null,
  ) {}

  async *chat(request: LlmChatRequest): AsyncGenerator<LlmEvent> {
    try {
      const { OpenAI: Client } = await import('openai');
      const client = new Client({
        apiKey: this.apiKey,
        baseURL: this.baseUrl,
        timeout: LLM_TIMEOUT_MS,
      });
      yield* openAiEvents(
        await client.chat.completions.create(openAiRequest(this.model, this.baseUrl, request), {
          signal: request.signal,
        }),
      );
    } catch (err) {
      yield { type: 'error', code: errorCodeOf(err) };
    }
  }
}
