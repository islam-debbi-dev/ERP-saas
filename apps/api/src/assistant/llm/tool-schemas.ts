import { ASSISTANT_TOOL_NAMES, ASSISTANT_TOOLS } from '@erp/shared';
import { z } from 'zod';
import type { LlmTool } from './llm-provider';

/** The tools as JSON Schema, sorted: the same bytes every time keeps the cache warm. */
export function llmTools(): LlmTool[] {
  return ASSISTANT_TOOL_NAMES.map((name) => {
    const { $schema: _schema, ...inputSchema } = z.toJSONSchema(ASSISTANT_TOOLS[name].input, {
      io: 'input',
    });
    return { name, description: ASSISTANT_TOOLS[name].description, inputSchema };
  });
}

const UNSUPPORTED_WHEN_STRICT = new Set([
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'pattern',
]);

/**
 * Strict tool schemas refuse length and range constraints. They are only dropped from
 * what the provider sees: zod still checks them after every call.
 */
export function strictSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const clean = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(clean);
    if (typeof value !== 'object' || value === null) return value;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !UNSUPPORTED_WHEN_STRICT.has(key))
        .map(([key, v]) => [key, clean(v)]),
    );
  };
  return clean(schema) as Record<string, unknown>;
}
