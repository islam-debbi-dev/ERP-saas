import { ErrorCode } from '@erp/shared';
import anthropic from './__fixtures__/anthropic.json';
import gemini from './__fixtures__/gemini.json';
import openai from './__fixtures__/openai.json';
import {
  anthropicEvents,
  anthropicRequest,
  anthropicTools,
  type AnthropicStream,
} from './anthropic.provider';
import { geminiErrorCode, geminiEvents, geminiRequest, geminiTools } from './gemini.provider';
import { errorCodeOf, type LlmChatRequest, type LlmEvent } from './llm-provider';
import { openAiEvents, openAiRequest, openAiTools } from './openai-compatible.provider';
import { llmTools } from './tool-schemas';

/**
 * The same conversation in each provider's documented wire format must give the same
 * normalized events: nothing past the adapter may depend on who answered.
 */
async function* from<T>(items: readonly unknown[]): AsyncGenerator<T> {
  await Promise.resolve();
  for (const item of items) yield item as T;
}

async function collect(events: AsyncIterable<LlmEvent>): Promise<LlmEvent[]> {
  const out: LlmEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

type Scenario = 'text' | 'tool' | 'maxTokens' | 'refusal';

const runs: Record<string, (s: Scenario) => AsyncIterable<LlmEvent>> = {
  anthropic: (s) => {
    const stream = Object.assign(from(anthropic[s].events), {
      finalMessage: () => Promise.resolve(anthropic[s].final),
    });
    return anthropicEvents(stream as unknown as AnthropicStream);
  },
  gemini: (s) => geminiEvents(from(gemini[s].chunks)),
  openai: (s) => openAiEvents(from(openai[s].chunks)),
};

const usage = { inputTokens: 1000, cachedTokens: 850, outputTokens: 40 };
const withoutReplay = (events: LlmEvent[]) =>
  events.map((e) => (e.type === 'done' ? { ...e, replay: null } : e));

const request: LlmChatRequest = {
  system: { stable: 'STABLE', dynamic: 'DYNAMIC' },
  messages: [{ role: 'user', content: 'salam' }],
  tools: llmTools(),
  maxOutputTokens: 1500,
};

describe.each(Object.keys(runs))('%s adapter', (name) => {
  const run = (s: Scenario) => collect(runs[name]?.(s) ?? from([]));

  it('streams text and reports usage, cached tokens inside the input', async () => {
    expect(withoutReplay(await run('text'))).toEqual([
      { type: 'text', delta: 'Bonjour ' },
      { type: 'text', delta: 'Karim' },
      { type: 'done', stopReason: 'end_turn', usage, replay: null },
    ]);
  });

  it('normalizes a tool call', async () => {
    expect(withoutReplay(await run('tool'))).toEqual([
      { type: 'text', delta: 'Je cherche.' },
      {
        type: 'tool_call',
        call: { id: 'call-1', name: 'search_clients', input: { query: 'karim' } },
      },
      { type: 'done', stopReason: 'tool_use', usage, replay: null },
    ]);
  });

  it('reports a cut answer and a refusal', async () => {
    expect((await run('maxTokens')).at(-1)).toMatchObject({ stopReason: 'max_tokens' });
    expect((await run('refusal')).at(-1)).toMatchObject({ stopReason: 'refusal' });
  });
});

describe('replay between tool rounds', () => {
  it('keeps Anthropic thinking blocks', async () => {
    const done = (await collect(runs['anthropic']?.('tool') ?? from([]))).at(-1);
    expect((done as { replay: unknown[] }).replay).toContainEqual(anthropic.tool.final.content[0]);
  });

  it('keeps Gemini thought signatures', async () => {
    const done = (await collect(runs['gemini']?.('tool') ?? from([]))).at(-1);
    const replay = (done as { replay: { thoughtSignature?: string }[] }).replay;
    expect(replay.map((part) => part.thoughtSignature)).toContain('sig-1');
  });

  it('hands the Anthropic replay back as the assistant turn', () => {
    const replay = anthropic.tool.final.content;
    const params = anthropicRequest('claude-opus-5-5', {
      ...request,
      messages: [
        { role: 'user', content: 'salam' },
        { role: 'assistant_turn', text: 'Je cherche.', toolCalls: [], replay },
        {
          role: 'tool_results',
          results: [{ id: 'call-1', name: 'search_clients', content: '[]', isError: false }],
        },
      ],
    });
    expect(params.messages[1]).toEqual({ role: 'assistant', content: replay });
    expect(params.messages[2]?.content).toEqual([
      { type: 'tool_result', tool_use_id: 'call-1', content: '[]', is_error: false },
    ]);
  });
});

describe('broken tool input', () => {
  it('reaches the service as undefined, for zod to refuse, instead of crashing', async () => {
    const events = await collect(openAiEvents(from(openai.badJson.chunks)));
    expect(events[0]).toEqual({
      type: 'tool_call',
      call: { id: 'call-1', name: 'search_clients', input: undefined },
    });
  });
});

describe('requests', () => {
  it('Anthropic: breakpoint on the stable text, the dynamic text after it', () => {
    expect(anthropicRequest('claude-opus-5-5', request).system).toEqual([
      { type: 'text', text: 'STABLE', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'DYNAMIC' },
    ]);
  });

  it('Anthropic: effort and fallbacks only on the models that take them', () => {
    expect(anthropicRequest('claude-opus-5-5', request)).toMatchObject({
      output_config: { effort: 'low' },
      fallbacks: 'default',
      betas: ['server-side-fallback-2026-07-01'],
    });
    const haiku = anthropicRequest('claude-haiku-5-5', request);
    expect(haiku).toMatchObject({ output_config: { effort: 'low' } });
    expect(haiku).not.toHaveProperty('fallbacks');
    const old = anthropicRequest('claude-haiku-4-5', request);
    expect(old).not.toHaveProperty('output_config');
    expect(old).not.toHaveProperty('betas');
  });

  it('Gemini and OpenAI-compatible: stable text first', () => {
    expect(geminiRequest('gemini-flash', request).config?.systemInstruction).toBe(
      'STABLE\n\nDYNAMIC',
    );
    expect(openAiRequest('gpt', null, request).messages[0]).toEqual({
      role: 'system',
      content: 'STABLE\n\nDYNAMIC',
    });
  });

  it('OpenAI-compatible: strict and max_completion_tokens on OpenAI only', () => {
    expect(openAiRequest('gpt', null, request)).toMatchObject({ max_completion_tokens: 1500 });
    const local = openAiRequest('llama', 'http://localhost:11434/v1', request);
    expect(local).toMatchObject({ max_tokens: 1500 });
    expect(local).not.toHaveProperty('max_completion_tokens');
    expect(local.tools?.[0]).not.toHaveProperty('function.strict');
  });
});

describe('tool schema conversion', () => {
  const tools = llmTools();

  it('keeps a stable, sorted list', () => {
    expect(tools.map((t) => t.name)).toEqual([...tools.map((t) => t.name)].sort());
    expect(JSON.stringify(llmTools())).toBe(JSON.stringify(tools));
  });

  it('matches the snapshot per provider', () => {
    expect(anthropicTools(tools)).toMatchSnapshot('anthropic');
    expect(geminiTools(tools)).toMatchSnapshot('gemini');
    expect(openAiTools(tools, true)).toMatchSnapshot('openai strict');
  });

  it('gives strict tools no constraint the API refuses', () => {
    const text = JSON.stringify([anthropicTools(tools), openAiTools(tools, true)]);
    expect(text).not.toMatch(/minLength|maxLength|"pattern"/);
    expect(text).toContain('"additionalProperties":false');
  });
});

describe('error mapping', () => {
  it('maps the status, whatever the provider said', () => {
    const secret = { message: 'key sk-secret refused' };
    expect(errorCodeOf({ ...secret, status: 401 })).toBe(ErrorCode.AI_INVALID_KEY);
    expect(errorCodeOf({ ...secret, status: 403 })).toBe(ErrorCode.AI_INVALID_KEY);
    expect(errorCodeOf({ ...secret, status: 404 })).toBe(ErrorCode.AI_MODEL_NOT_FOUND);
    expect(errorCodeOf({ ...secret, status: 429 })).toBe(ErrorCode.AI_RATE_LIMITED);
    expect(errorCodeOf({ ...secret, status: 529 })).toBe(ErrorCode.AI_UNAVAILABLE);
    expect(errorCodeOf(new Error('socket hang up'))).toBe(ErrorCode.AI_UNAVAILABLE);
  });

  it('reads Gemini bad keys from its 400', () => {
    expect(geminiErrorCode({ status: 400, message: 'API key not valid.' })).toBe(
      ErrorCode.AI_INVALID_KEY,
    );
    expect(geminiErrorCode({ status: 400, message: 'bad request' })).toBe(ErrorCode.AI_UNAVAILABLE);
  });
});
