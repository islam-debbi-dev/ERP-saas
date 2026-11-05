import type { Anthropic } from '@anthropic-ai/sdk';
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

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type BetaParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type BetaEvent = Anthropic.Beta.Messages.BetaRawMessageStreamEvent;
type BetaTool = Anthropic.Beta.Messages.BetaTool;

/** What the adapter reads from the SDK's message stream. */
export interface AnthropicStream extends AsyncIterable<BetaEvent> {
  finalMessage(): Promise<BetaMessage>;
}

/** Models that take `effort`, and the ones that can retry a refusal server-side. */
const EFFORT_MODELS = /^claude-(opus|sonnet|fable|haiku|mythos)-5/;
const FALLBACK_MODELS = /^claude-(fable-5|opus-5|sonnet-5-5)/;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export function anthropicTools(tools: LlmTool[]): BetaTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: strictSchema(tool.inputSchema) as BetaTool['input_schema'],
    strict: true,
  }));
}

function anthropicMessages(messages: LlmMessage[]): BetaMessageParam[] {
  return messages.map((m): BetaMessageParam => {
    switch (m.role) {
      case 'user':
      case 'assistant':
        return { role: m.role, content: m.content };
      case 'assistant_turn':
        // Thinking blocks must come back unchanged within a tool loop.
        return {
          role: 'assistant',
          content: m.replay as Anthropic.Beta.Messages.BetaContentBlockParam[],
        };
      case 'tool_results':
        return {
          role: 'user',
          content: m.results.map((r) => ({
            type: 'tool_result' as const,
            tool_use_id: r.id,
            content: r.content,
            is_error: r.isError,
          })),
        };
    }
  });
}

export function anthropicRequest(model: string, request: LlmChatRequest): BetaParams {
  const fallback = FALLBACK_MODELS.test(model);
  return {
    model,
    max_tokens: request.maxOutputTokens,
    // The breakpoint covers the tools and the stable text; the rest is after it.
    system: [
      { type: 'text', text: request.system.stable, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: request.system.dynamic },
    ],
    ...(request.tools.length > 0 ? { tools: anthropicTools(request.tools) } : {}),
    messages: anthropicMessages(request.messages),
    ...(EFFORT_MODELS.test(model) ? { output_config: { effort: 'low' as const } } : {}),
    ...(fallback ? { fallbacks: 'default' as const, betas: [FALLBACK_BETA] } : {}),
  };
}

function stopReason(reason: BetaMessage['stop_reason']): LlmStopReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end_turn';
    case 'tool_use':
    case 'max_tokens':
    case 'refusal':
      return reason;
    default:
      return 'other';
  }
}

/** The SDK stream as normalized events. Pure, so recorded fixtures can drive it. */
export async function* anthropicEvents(stream: AnthropicStream): AsyncGenerator<LlmEvent> {
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      yield { type: 'text', delta: event.delta.text };
    }
  }
  const message = await stream.finalMessage();
  for (const block of message.content) {
    if (block.type === 'tool_use') {
      yield { type: 'tool_call', call: { id: block.id, name: block.name, input: block.input } };
    }
  }
  const { usage } = message;
  const cachedTokens = usage.cache_read_input_tokens ?? 0;
  yield {
    type: 'done',
    stopReason: stopReason(message.stop_reason),
    usage: {
      inputTokens: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + cachedTokens,
      cachedTokens,
      outputTokens: usage.output_tokens,
    },
    replay: message.content,
  };
}

export class AnthropicProvider implements LlmProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async *chat(request: LlmChatRequest): AsyncGenerator<LlmEvent> {
    try {
      // Loaded on first use: most requests of the API never need a provider SDK.
      const { Anthropic: Client } = await import('@anthropic-ai/sdk');
      const client = new Client({ apiKey: this.apiKey, timeout: LLM_TIMEOUT_MS });
      yield* anthropicEvents(
        client.beta.messages.stream(anthropicRequest(this.model, request), {
          signal: request.signal,
        }),
      );
    } catch (err) {
      yield { type: 'error', code: errorCodeOf(err) };
    }
  }
}
