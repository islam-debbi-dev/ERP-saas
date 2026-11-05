import { Injectable } from '@nestjs/common';
import type { AiProvider } from '@erp/shared';
import { AnthropicProvider } from './anthropic.provider';
import { GeminiProvider } from './gemini.provider';
import type { LlmProvider } from './llm-provider';
import { OpenAiCompatibleProvider } from './openai-compatible.provider';

export interface LlmConnection {
  provider: AiProvider;
  model: string;
  baseUrl: string | null;
  apiKey: string;
}

/** Tests replace this one class to swap every provider for a FakeLlmProvider. */
@Injectable()
export class LlmProviderFactory {
  create({ provider, model, baseUrl, apiKey }: LlmConnection): LlmProvider {
    switch (provider) {
      case 'ANTHROPIC':
        return new AnthropicProvider(apiKey, model);
      case 'GEMINI':
        return new GeminiProvider(apiKey, model);
      case 'OPENAI_COMPATIBLE':
        return new OpenAiCompatibleProvider(apiKey, model, baseUrl);
    }
  }
}
