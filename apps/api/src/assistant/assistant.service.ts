import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AI_HISTORY_MESSAGES,
  AI_MAX_TOOL_ROUNDS,
  AI_QUESTIONS_PER_DAY,
  AI_RETENTION_DAYS,
  algiersDay,
  type AssistantChatInput,
  type AssistantConversationDetailDto,
  type AssistantConversationPage,
  type AssistantConversationsQuery,
  type AssistantFeedbackInput,
  type AssistantLink,
  type AssistantStatusDto,
  type AssistantStreamEvent,
  type AssistantToolName,
  ErrorCode,
  Feature,
  Permission,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { can } from '../auth/permissions';
import { BillingService } from '../billing/billing.service';
import { FeaturesService } from '../billing/features.service';
import { ClockService } from '../clock/clock.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { APP_CONFIG, type AppConfig, isSingle } from '../config/app-config';
import { type Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WarehousesService } from '../stock/warehouses.service';
import { TenantsService } from '../tenants/tenants.service';
import { AiConfigService, type ResolvedAiConfig } from './ai-config.service';
import { isAppRoute } from './help/help-articles';
import { detectLanguage, fallbackText, type LanguageHint } from './language';
import type {
  LlmErrorCode,
  LlmMessage,
  LlmStopReason,
  LlmSystemPrompt,
  LlmToolCall,
  LlmToolResult,
  LlmUsage,
} from './llm/llm-provider';
import { LlmProviderFactory } from './llm/llm-provider.factory';
import { llmTools } from './llm/tool-schemas';
import { dynamicContext, stablePrompt } from './system-prompt';
import { AssistantToolsService, type ToolStatus } from './tools/assistant-tools.service';
import { algiersMonth, algiersToday, costMicroUsd } from './usage-math';

const MAX_LINKS = 4;
const TITLE_LENGTH = 80;

/** A question that passed every check and is stored, ready to go to the model. */
export interface PreparedChat {
  config: ResolvedAiConfig;
  conversationId: string;
  conversationIsNew: boolean;
  userMessageId: string;
  language: LanguageHint;
  system: LlmSystemPrompt;
  history: LlmMessage[];
}

interface StoredToolCall {
  name: string;
  input: unknown;
  status: ToolStatus;
}

/** Links offered with an answer: the tools', then the ones in the text, real screens only. */
export function answerLinks(toolLinks: AssistantLink[], text: string): AssistantLink[] {
  const inText = [...text.matchAll(/\[([^\]]{1,80})\]\((\/[^)\s]*)\)/g)].map((m) => ({
    label: m[1] ?? '',
    href: m[2] ?? '',
  }));
  const seen = new Set<string>();
  return [...toolLinks, ...inText]
    .filter((link) => {
      if (!isAppRoute(link.href) || seen.has(link.href)) return false;
      seen.add(link.href);
      return true;
    })
    .slice(0, MAX_LINKS);
}

/** The in-app assistant (phase 30): checks, the tool loop, and the conversation store. */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configs: AiConfigService,
    private readonly llm: LlmProviderFactory,
    private readonly tools: AssistantToolsService,
    private readonly features: FeaturesService,
    private readonly billing: BillingService,
    private readonly tenants: TenantsService,
    private readonly warehouses: WarehousesService,
    private readonly clock: ClockService,
    @Inject(APP_CONFIG) private readonly appConfig: AppConfig,
  ) {}

  async status(user: CurrentUserInfo): Promise<AssistantStatusDto> {
    const off = { available: false, provider: null };
    if (!can(user, Permission.USE_ASSISTANT) || user.impersonatedBy) return off;
    const { features } = await this.features.of(user.tenantId);
    if (!features.includes(Feature.AI_ASSISTANT)) return off;
    const provider = await this.configs.activeProvider(user.tenantId);
    return provider ? { available: true, provider } : off;
  }

  // --- Limits --------------------------------------------------------------------------

  private async assertDailyLimit(user: CurrentUserInfo): Promise<void> {
    const { start, end } = algiersToday(this.clock.now());
    const asked = await this.prisma.db.assistantMessage.count({
      where: { userId: user.id, role: 'USER', createdAt: { gte: start, lt: end } },
    });
    if (asked >= AI_QUESTIONS_PER_DAY) {
      throw new AppException(ErrorCode.AI_DAILY_LIMIT, 'Daily question limit reached');
    }
  }

  /** Only questions on the platform's key count: a company on its own key pays its provider. */
  private async assertPlanQuota(user: CurrentUserInfo, config: ResolvedAiConfig): Promise<void> {
    if (config.scope !== 'PLATFORM' || isSingle(this.appConfig)) return;
    const limit = await this.billing.aiQuestionsPerMonth(user.tenantId);
    if (limit === null) return;
    const { start, end, resetDate } = algiersMonth(this.clock.now());
    const asked = await this.prisma.db.assistantMessage.count({
      where: { role: 'USER', configScope: 'PLATFORM', createdAt: { gte: start, lt: end } },
    });
    if (asked >= limit) {
      throw new AppException(ErrorCode.AI_QUOTA_EXCEEDED, 'Monthly question quota reached', {
        resetDate,
        limit,
      });
    }
  }

  // --- Chat ----------------------------------------------------------------------------

  /** Everything that can refuse a question, before the first byte of the stream. */
  async prepare(input: AssistantChatInput, user: CurrentUserInfo): Promise<PreparedChat> {
    const config = await this.configs.resolve(user.tenantId);
    if (!config) throw new AppException(ErrorCode.AI_NOT_CONFIGURED, 'The assistant is off');
    await this.assertDailyLimit(user);
    await this.assertPlanQuota(user, config);
    // Vercel has no reliable timer: every question also clears what is past its time.
    await this.purgeExpired();

    const language = detectLanguage(input.message);
    const conversationId =
      input.conversationId ?? (await this.createConversation(input.message, language, user));
    if (input.conversationId) await this.requireConversation(input.conversationId, user);

    const { id: userMessageId } = await this.prisma.db.assistantMessage.create({
      data: {
        tenantId: user.tenantId,
        conversationId,
        userId: user.id,
        role: 'USER',
        content: input.message,
        provider: config.provider,
        model: config.model,
        configScope: config.scope,
      },
      select: { id: true },
    });

    return {
      config,
      conversationId,
      conversationIsNew: !input.conversationId,
      userMessageId,
      language,
      system: await this.systemPrompt(user, language),
      history: await this.history(conversationId),
    };
  }

  private async createConversation(
    message: string,
    language: LanguageHint,
    user: CurrentUserInfo,
  ): Promise<string> {
    const { id } = await this.prisma.db.assistantConversation.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        title: message.slice(0, TITLE_LENGTH),
        language,
      },
      select: { id: true },
    });
    return id;
  }

  private async systemPrompt(
    user: CurrentUserInfo,
    language: LanguageHint,
  ): Promise<LlmSystemPrompt> {
    const [{ edition, features }, settings, depots] = await Promise.all([
      this.features.of(user.tenantId),
      this.tenants.getSettings(),
      this.warehouses.list(user),
    ]);
    return {
      stable: stablePrompt(features),
      dynamic: dynamicContext({
        companyName: settings.name,
        edition,
        features,
        role: user.role,
        depots: depots.map((d) => d.name),
        today: algiersDay(this.clock.now()),
        language,
      }),
    };
  }

  /** The last messages as text. Tool rounds of earlier questions are not replayed. */
  private async history(conversationId: string): Promise<LlmMessage[]> {
    const rows = await this.prisma.db.assistantMessage.findMany({
      where: { conversationId },
      orderBy: { seq: 'desc' },
      take: AI_HISTORY_MESSAGES,
      select: { role: true, content: true },
    });
    const messages = rows
      .reverse()
      .filter((r) => r.content !== '')
      .map((r): LlmMessage => ({
        role: r.role === 'USER' ? 'user' : 'assistant',
        content: r.content,
      }));
    // The window may start on an answer; a conversation starts with the user.
    return messages[0]?.role === 'assistant' ? messages.slice(1) : messages;
  }

  /**
   * The tool loop, the same for every provider. Keeps going when the client leaves, so
   * what was paid for is stored. Never throws for a provider failure: it ends with an
   * `error` event, since the HTTP status is long gone.
   */
  async *run(
    chat: PreparedChat,
    user: CurrentUserInfo,
    signal?: AbortSignal,
  ): AsyncGenerator<AssistantStreamEvent> {
    const { config, conversationId, language } = chat;
    yield { type: 'conversation', conversationId };

    const provider = this.llm.create(config);
    const tools = llmTools();
    const messages = [...chat.history];
    const usage: LlmUsage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };
    const calls: StoredToolCall[] = [];
    const toolLinks: AssistantLink[] = [];
    let answer = '';
    let truncated = false;

    for (let round = 0; round <= AI_MAX_TOOL_ROUNDS; round += 1) {
      let text = '';
      let stop: LlmStopReason = 'other';
      let replay: unknown = null;
      let failed: LlmErrorCode | null = null;
      const toolCalls: LlmToolCall[] = [];

      const events = provider.chat({
        system: chat.system,
        messages,
        tools,
        maxOutputTokens: this.appConfig.AI_MAX_OUTPUT_TOKENS,
        signal,
      });
      for await (const event of events) {
        switch (event.type) {
          case 'text': {
            // Two rounds of text must not run together.
            const delta = text === '' && answer !== '' ? `\n\n${event.delta}` : event.delta;
            text += delta;
            answer += delta;
            yield { type: 'text', delta };
            break;
          }
          case 'tool_call':
            toolCalls.push(event.call);
            break;
          case 'done':
            stop = event.stopReason;
            replay = event.replay;
            usage.inputTokens += event.usage.inputTokens;
            usage.cachedTokens += event.usage.cachedTokens;
            usage.outputTokens += event.usage.outputTokens;
            break;
          case 'error':
            failed = event.code;
            break;
        }
      }

      if (failed) {
        // Gone because the client left: the question stays, it was asked and may be paid.
        if (signal?.aborted) break;
        this.logger.warn({ code: failed, provider: config.provider }, 'Assistant provider failed');
        if (answer === '') await this.forgetQuestion(chat);
        else await this.saveAnswer(chat, user, answer, calls, toolLinks, usage);
        yield { type: 'error', code: failed };
        return;
      }

      if (stop === 'refusal') {
        // A refusal can come after some text: that part must not stand as an answer.
        answer = fallbackText.refusal(language);
        yield { type: 'replace', text: answer };
        break;
      }
      if (stop === 'max_tokens') {
        truncated = true;
        break;
      }
      if (toolCalls.length === 0) break;
      if (round === AI_MAX_TOOL_ROUNDS) {
        answer = fallbackText.tooManySteps(language);
        yield { type: 'replace', text: answer };
        break;
      }

      const results: LlmToolResult[] = [];
      for (const call of toolCalls) {
        yield { type: 'tool', name: call.name as AssistantToolName };
        const outcome = await this.tools.run(call.name, call.input, user);
        calls.push({ name: call.name, input: call.input, status: outcome.status });
        toolLinks.push(...outcome.links);
        results.push({
          id: call.id,
          name: call.name,
          content: JSON.stringify(outcome.result),
          isError: outcome.status !== 'OK',
        });
      }
      messages.push(
        { role: 'assistant_turn', text, toolCalls, replay },
        { role: 'tool_results', results },
      );
    }

    if (answer === '') answer = fallbackText.refusal(language);
    const saved = await this.saveAnswer(chat, user, answer, calls, toolLinks, usage);
    if (saved.links.length > 0) yield { type: 'links', links: saved.links };
    yield { type: 'done', messageId: saved.id, conversationId, truncated };
  }

  private async saveAnswer(
    chat: PreparedChat,
    user: CurrentUserInfo,
    answer: string,
    calls: StoredToolCall[],
    toolLinks: AssistantLink[],
    usage: LlmUsage,
  ): Promise<{ id: string; links: AssistantLink[] }> {
    const links = answerLinks(toolLinks, answer);
    const { provider, model, scope, prices } = chat.config;
    const { id } = await this.prisma.db.assistantMessage.create({
      data: {
        tenantId: user.tenantId,
        conversationId: chat.conversationId,
        userId: user.id,
        role: 'ASSISTANT',
        content: answer,
        toolCalls: calls as unknown as Prisma.InputJsonValue,
        links: links as unknown as Prisma.InputJsonValue,
        inputTokens: usage.inputTokens,
        cachedTokens: usage.cachedTokens,
        outputTokens: usage.outputTokens,
        provider,
        model,
        configScope: scope,
        costMicroUsd: costMicroUsd(usage, prices),
      },
      select: { id: true },
    });
    return { id, links };
  }

  /** A provider failure with no answer costs the user nothing: not a question, not quota. */
  private async forgetQuestion(chat: PreparedChat): Promise<void> {
    await this.prisma.db.assistantMessage.deleteMany({ where: { id: chat.userMessageId } });
    if (chat.conversationIsNew) {
      await this.prisma.db.assistantConversation.deleteMany({
        where: { id: chat.conversationId },
      });
    }
  }

  // --- Conversations -------------------------------------------------------------------

  private async requireConversation(id: string, user: CurrentUserInfo) {
    const conversation = await this.prisma.db.assistantConversation.findFirst({
      where: { id, userId: user.id },
    });
    if (!conversation) throw new AppException(ErrorCode.NOT_FOUND, 'Conversation not found');
    return conversation;
  }

  async conversations(
    query: AssistantConversationsQuery,
    user: CurrentUserInfo,
  ): Promise<AssistantConversationPage> {
    const rows = await this.prisma.db.assistantConversation.findMany({
      where: { userId: user.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((c) => ({
        id: c.id,
        title: c.title,
        language: c.language,
        createdAt: c.createdAt.toISOString(),
      })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async conversation(id: string, user: CurrentUserInfo): Promise<AssistantConversationDetailDto> {
    const c = await this.requireConversation(id, user);
    const messages = await this.prisma.db.assistantMessage.findMany({
      where: { conversationId: id },
      orderBy: { seq: 'asc' },
    });
    return {
      id: c.id,
      title: c.title,
      language: c.language,
      createdAt: c.createdAt.toISOString(),
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        links: (m.links as AssistantLink[] | null) ?? [],
        useful: m.useful,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  /** Chat history, not business data: a real delete (the messages cascade). */
  async deleteConversation(id: string, user: CurrentUserInfo): Promise<void> {
    await this.requireConversation(id, user);
    await this.prisma.db.assistantConversation.deleteMany({ where: { id, userId: user.id } });
  }

  async feedback(
    messageId: string,
    input: AssistantFeedbackInput,
    user: CurrentUserInfo,
  ): Promise<void> {
    const { count } = await this.prisma.db.assistantMessage.updateMany({
      where: { id: messageId, userId: user.id, role: 'ASSISTANT' },
      data: { useful: input.useful, feedbackComment: input.comment ?? null },
    });
    if (count === 0) throw new AppException(ErrorCode.NOT_FOUND, 'Message not found');
  }

  /** This company's conversations past the retention, on demand. */
  private async purgeExpired(): Promise<void> {
    await this.prisma.db.assistantConversation.deleteMany({
      where: { createdAt: { lt: retentionCutoff(this.clock.now()) } },
    });
  }

  /** Every company's, for the daily job. */
  async purgeAllExpired(): Promise<number> {
    const { count } = await tenantContext.runAsSystem(() =>
      this.prisma.db.assistantConversation.deleteMany({
        where: { createdAt: { lt: retentionCutoff(this.clock.now()) } },
      }),
    );
    return count;
  }
}

export function retentionCutoff(now: Date): Date {
  return new Date(now.getTime() - AI_RETENTION_DAYS * 86_400_000);
}
