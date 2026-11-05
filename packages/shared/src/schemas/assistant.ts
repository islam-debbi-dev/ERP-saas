import { z } from 'zod';
import type { ErrorCode } from '../errors';

/** Phase 30: the in-app assistant. Tools, chat, provider settings and usage. */

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_date');

export const AI_MESSAGE_MAX_LENGTH = 2000;
/** Rounds of tool calls for one question, whatever the provider. */
export const AI_MAX_TOOL_ROUNDS = 5;
/** Messages of the conversation sent back to the model. */
export const AI_HISTORY_MESSAGES = 20;
/** Rows a tool may return. */
export const AI_TOOL_MAX_ROWS = 20;
export const AI_QUESTIONS_PER_MINUTE = 10;
export const AI_QUESTIONS_PER_DAY = 100;
/** Conversations older than this are deleted. */
export const AI_RETENTION_DAYS = 90;

export const AI_PROVIDERS = ['ANTHROPIC', 'GEMINI', 'OPENAI_COMPATIBLE'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_CONFIG_SCOPES = ['PLATFORM', 'TENANT'] as const;
export type AiConfigScope = (typeof AI_CONFIG_SCOPES)[number];

// --- Tools -----------------------------------------------------------------------------

const searchQuery = z.string().trim().min(1).max(80);

/**
 * The assistant's tools, defined once. Each adapter turns `input` into its provider's
 * format; the input is validated again here after every call, whatever the provider.
 * Every tool only reads.
 */
export const ASSISTANT_TOOLS = {
  search_clients: {
    description:
      'Find clients of this company by name, code or phone. Use it first to get a clientId.',
    input: z.strictObject({ query: searchQuery }),
  },
  client_balance: {
    description:
      'Balance of one client: what he owes, his oldest unpaid date, last versement, split per dépôt.',
    input: z.strictObject({ clientId: z.uuid() }),
  },
  search_products: {
    description: 'Find products by designation, reference or barcode. Gives a productId.',
    input: z.strictObject({ query: searchQuery }),
  },
  product_stock: {
    description:
      'Stock of one product per dépôt, in base unit and main unit, with its alert level.',
    input: z.strictObject({ productId: z.uuid() }),
  },
  sales_summary: {
    description:
      "Sales total (TTC, net of returns), number of sales and encaissements between two dates included, in the user's scope. Dates are YYYY-MM-DD, Algiers time.",
    input: z.strictObject({ from: dateString, to: dateString }),
  },
  clients_to_remind: {
    description: 'The clients à relancer: they owe and their oldest unpaid amount is too old.',
    input: z.strictObject({}),
  },
  find_document: {
    description:
      'Find one document by its number (sale, facture, avoir, versement, purchase): status, client, total, date.',
    input: z.strictObject({ number: z.string().trim().min(3).max(40) }),
  },
} as const;

export type AssistantToolName = keyof typeof ASSISTANT_TOOLS;
export const ASSISTANT_TOOL_NAMES = Object.keys(ASSISTANT_TOOLS).sort() as AssistantToolName[];

// --- Chat ------------------------------------------------------------------------------

export const assistantChatSchema = z.object({
  conversationId: z.uuid().optional(),
  message: z.string().trim().min(1).max(AI_MESSAGE_MAX_LENGTH),
});
export type AssistantChatInput = z.infer<typeof assistantChatSchema>;

export const assistantFeedbackSchema = z.object({
  useful: z.boolean(),
  comment: z.string().trim().max(500).optional(),
});
export type AssistantFeedbackInput = z.infer<typeof assistantFeedbackSchema>;

export const assistantConversationsQuerySchema = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type AssistantConversationsQuery = z.infer<typeof assistantConversationsQuerySchema>;

export interface AssistantLink {
  label: string;
  href: string;
}

/** What `POST /assistant/chat` streams, one JSON object per SSE `data:` line. */
export type AssistantStreamEvent =
  | { type: 'conversation'; conversationId: string }
  | { type: 'text'; delta: string }
  /** What was streamed so far must not stand: show this text instead (a refusal). */
  | { type: 'replace'; text: string }
  | { type: 'tool'; name: AssistantToolName }
  | { type: 'links'; links: AssistantLink[] }
  | { type: 'done'; messageId: string; conversationId: string; truncated: boolean }
  | { type: 'error'; code: ErrorCode };

export interface AssistantStatusDto {
  /** False hides the button: flag off, no permission, no provider, read-only session. */
  available: boolean;
  /** The provider the questions go to, shown under the input. */
  provider: AiProvider | null;
}

export interface AssistantConversationDto {
  id: string;
  title: string;
  language: string | null;
  createdAt: string;
}

export interface AssistantConversationPage {
  items: AssistantConversationDto[];
  nextCursor: string | null;
}

export interface AssistantMessageDto {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  links: AssistantLink[];
  useful: boolean | null;
  createdAt: string;
}

export interface AssistantConversationDetailDto extends AssistantConversationDto {
  messages: AssistantMessageDto[];
}

// --- Provider settings -----------------------------------------------------------------

const pricePerMTok = z
  .string()
  .trim()
  .regex(/^\d{1,5}(\.\d{1,4})?$/, 'invalid_price');

export const aiProviderConfigSchema = z
  .object({
    provider: z.enum(AI_PROVIDERS),
    model: z.string().trim().min(1).max(120),
    baseUrl: z
      .string()
      .trim()
      .max(255)
      .transform((v) => (v === '' ? null : v))
      .pipe(z.url({ protocol: /^https?$/ }).nullable())
      .nullable()
      .default(null),
    /** Absent: keep the saved key. Never sent back by the API. */
    apiKey: z.string().trim().min(8).max(400).optional(),
    inputPricePerMTokUsd: pricePerMTok,
    cachedInputPricePerMTokUsd: pricePerMTok,
    outputPricePerMTokUsd: pricePerMTok,
    enabled: z.boolean(),
  })
  .refine((v) => v.provider === 'OPENAI_COMPATIBLE' || v.baseUrl === null, {
    path: ['baseUrl'],
    message: 'base_url_openai_compatible_only',
  })
  .refine((v) => v.provider !== 'OPENAI_COMPATIBLE' || v.baseUrl !== null, {
    path: ['baseUrl'],
    message: 'base_url_required',
  });
export type AiProviderConfigInput = z.infer<typeof aiProviderConfigSchema>;

/** The settings as the screen sees them. The key itself never leaves the API. */
export interface AiProviderConfigDto {
  provider: AiProvider;
  model: string;
  baseUrl: string | null;
  /** The last 4 characters, for `••••1a2b`. */
  keyHint: string;
  inputPricePerMTokUsd: string;
  cachedInputPricePerMTokUsd: string;
  outputPricePerMTokUsd: string;
  enabled: boolean;
  updatedAt: string;
}

export interface AiTenantConfigResponse {
  /** May this company set its own key? */
  allowed: boolean;
  config: AiProviderConfigDto | null;
}

export interface AiConfigTestResult {
  ok: boolean;
  code: ErrorCode | null;
  /** On failure: the provider's status and message (never the key), to see what went wrong. */
  detail?: string | null;
}

export const allowTenantAiKeySchema = z.object({ allowed: z.boolean() });
export type AllowTenantAiKeyInput = z.infer<typeof allowTenantAiKeySchema>;

// --- Usage (super-admin) ---------------------------------------------------------------

export const aiUsageQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'invalid_month'),
});
export type AiUsageQuery = z.infer<typeof aiUsageQuerySchema>;

export interface AiUsageRowDto {
  tenantId: string;
  tenantName: string;
  provider: AiProvider;
  model: string;
  configScope: AiConfigScope;
  questions: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  /** Decimal string, USD. On a company's own key the cost is the company's. */
  costUsd: string;
  useful: number;
  notUseful: number;
}

export interface AiBadAnswerDto {
  id: string;
  tenantName: string;
  question: string;
  answer: string;
  comment: string | null;
  createdAt: string;
}

export interface AiUsageDto {
  month: string;
  rows: AiUsageRowDto[];
  badAnswers: AiBadAnswerDto[];
}
