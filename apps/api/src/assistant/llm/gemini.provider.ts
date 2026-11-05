import { ErrorCode } from '@erp/shared';
import type {
  Content,
  FunctionDeclaration,
  GenerateContentParameters,
  GenerateContentResponse,
  Part,
} from '@google/genai';
import {
  errorCodeOf,
  LLM_TIMEOUT_MS,
  type LlmChatRequest,
  type LlmErrorCode,
  type LlmEvent,
  type LlmMessage,
  type LlmProvider,
  type LlmStopReason,
  type LlmTool,
} from './llm-provider';

const REFUSALS = new Set([
  'SAFETY',
  'RECITATION',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'LANGUAGE',
]);

export function geminiTools(tools: LlmTool[]): FunctionDeclaration[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: tool.inputSchema,
  }));
}

function geminiContents(messages: LlmMessage[]): Content[] {
  return messages.map((m): Content => {
    switch (m.role) {
      case 'user':
        return { role: 'user', parts: [{ text: m.content }] };
      case 'assistant':
        return { role: 'model', parts: [{ text: m.content }] };
      case 'assistant_turn':
        // Thought signatures live on these parts and must come back untouched.
        return { role: 'model', parts: m.replay as Part[] };
      case 'tool_results':
        return {
          role: 'user',
          parts: m.results.map((r) => ({
            functionResponse: {
              // Our generated ids mean the model sent none.
              ...(r.id.startsWith(GENERATED_ID) ? {} : { id: r.id }),
              name: r.name,
              response: r.isError ? { error: r.content } : { output: r.content },
            },
          })),
        };
    }
  });
}

export function geminiRequest(model: string, request: LlmChatRequest): GenerateContentParameters {
  return {
    model,
    contents: geminiContents(request.messages),
    config: {
      // Implicit caching matches on the prefix: the stable text comes first.
      systemInstruction: `${request.system.stable}\n\n${request.system.dynamic}`,
      ...(request.tools.length > 0
        ? { tools: [{ functionDeclarations: geminiTools(request.tools) }] }
        : {}),
      maxOutputTokens: request.maxOutputTokens,
      abortSignal: request.signal,
      httpOptions: { timeout: LLM_TIMEOUT_MS },
    },
  };
}

const GENERATED_ID = 'gemini-call-';

/** The chunks as normalized events. Pure, so recorded fixtures can drive it. */
export async function* geminiEvents(
  chunks: AsyncIterable<GenerateContentResponse>,
): AsyncGenerator<LlmEvent> {
  const parts: Part[] = [];
  let calls = 0;
  let finishReason: string | undefined;
  let blocked = false;
  let usage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };

  for await (const chunk of chunks) {
    if (chunk.promptFeedback?.blockReason) blocked = true;
    const candidate = chunk.candidates?.[0];
    finishReason = candidate?.finishReason ?? finishReason;
    for (const part of candidate?.content?.parts ?? []) {
      parts.push(part);
      if (part.functionCall) {
        yield {
          type: 'tool_call',
          call: {
            id: part.functionCall.id ?? `${GENERATED_ID}${calls}`,
            name: part.functionCall.name ?? '',
            input: part.functionCall.args,
          },
        };
        calls += 1;
      } else if (part.text && !part.thought) {
        yield { type: 'text', delta: part.text };
      }
    }
    const meta = chunk.usageMetadata;
    if (meta) {
      usage = {
        inputTokens: meta.promptTokenCount ?? 0,
        cachedTokens: meta.cachedContentTokenCount ?? 0,
        outputTokens: (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0),
      };
    }
  }

  const stop = (): LlmStopReason => {
    if (blocked || (finishReason && REFUSALS.has(finishReason))) return 'refusal';
    if (finishReason === 'MAX_TOKENS') return 'max_tokens';
    if (calls > 0) return 'tool_use';
    return finishReason === 'STOP' ? 'end_turn' : 'other';
  };
  yield { type: 'done', stopReason: stop(), usage, replay: parts };
}

/** Gemini answers a bad key with a 400, so its message is read here and goes no further. */
export function geminiErrorCode(err: unknown): LlmErrorCode {
  const { status, message } = (err ?? {}) as { status?: unknown; message?: unknown };
  if (status === 400 && typeof message === 'string' && /api[ _]?key/i.test(message)) {
    return ErrorCode.AI_INVALID_KEY;
  }
  return errorCodeOf(err);
}

export class GeminiProvider implements LlmProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async *chat(request: LlmChatRequest): AsyncGenerator<LlmEvent> {
    try {
      // ESM only: Jest on Node 22 cannot require() it, and import() works everywhere.
      const { GoogleGenAI } = await import('@google/genai');
      const client = new GoogleGenAI({ apiKey: this.apiKey });
      yield* geminiEvents(
        await client.models.generateContentStream(geminiRequest(this.model, request)),
      );
    } catch (err) {
      yield { type: 'error', code: geminiErrorCode(err) };
    }
  }
}
