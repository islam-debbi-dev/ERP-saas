import { Inject, Injectable } from '@nestjs/common';
import {
  type AiConfigScope,
  type AiConfigTestResult,
  type AiProvider,
  type AiProviderConfigDto,
  type AiProviderConfigInput,
  type AiTenantConfigResponse,
  ErrorCode,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { openSecret, parseSecretsKey, sealSecret } from '../common/crypto/secret-box';
import { tenantContext } from '../common/tenant-context';
import { APP_CONFIG, type AppConfig, isSingle } from '../config/app-config';
import type { AiProviderConfig } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { LlmProviderFactory, type LlmConnection } from './llm/llm-provider.factory';
import { assertPublicHttpsUrl } from './public-url';

/** Prices are decimal strings, USD per million tokens. */
export interface AiPrices {
  input: string;
  cachedInput: string;
  output: string;
}

/** What a request runs on. Holds the clear key: keep it in memory, out of logs and DTOs. */
export interface ResolvedAiConfig extends LlmConnection {
  scope: AiConfigScope;
  prices: AiPrices;
}

const ZERO_PRICES: AiPrices = { input: '0', cachedInput: '0', output: '0' };

/** The key's additional data: a box copied onto another company's row does not open. */
function secretContext(scope: AiConfigScope, tenantId: string | null): string {
  return scope === 'PLATFORM' ? 'ai:PLATFORM' : `ai:TENANT:${tenantId}`;
}

function toDto(row: AiProviderConfig): AiProviderConfigDto {
  return {
    provider: row.provider,
    model: row.model,
    baseUrl: row.baseUrl,
    keyHint: row.keyHint,
    inputPricePerMTokUsd: row.inputPricePerMTokUsd.toString(),
    cachedInputPricePerMTokUsd: row.cachedInputPricePerMTokUsd.toString(),
    outputPricePerMTokUsd: row.outputPricePerMTokUsd.toString(),
    enabled: row.enabled,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** What the journal keeps of a config. Never the key: only that it changed. */
function auditView(row: AiProviderConfig | null) {
  if (!row) return null;
  const { provider, model, baseUrl, enabled } = row;
  return { provider, model, baseUrl, enabled };
}

/** Which provider answers a company, and who may change that (phase 30, Part 0). */
@Injectable()
export class AiConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly llm: LlmProviderFactory,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** The only reader of the PLATFORM row: a company's context cannot see it. */
  private platformRow(): Promise<AiProviderConfig | null> {
    return tenantContext.runAsSystem(() =>
      this.prisma.db.aiProviderConfig.findFirst({ where: { scope: 'PLATFORM' } }),
    );
  }

  private tenantRow(tenantId: string): Promise<AiProviderConfig | null> {
    return this.prisma.db.aiProviderConfig.findFirst({ where: { scope: 'TENANT', tenantId } });
  }

  /** In single mode the OWNER runs the show; in SaaS only if the super-admin allowed it. */
  private async tenantKeyAllowed(tenantId: string): Promise<boolean> {
    if (isSingle(this.config)) return true;
    const { allowTenantAiKey } = await this.prisma.db.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { allowTenantAiKey: true },
    });
    return allowTenantAiKey;
  }

  private open(row: AiProviderConfig): ResolvedAiConfig {
    return {
      scope: row.scope,
      provider: row.provider,
      model: row.model,
      baseUrl: row.baseUrl,
      apiKey: openSecret(
        parseSecretsKey(this.config.SECRETS_ENCRYPTION_KEY),
        row.apiKeyEncrypted,
        secretContext(row.scope, row.tenantId),
      ),
      prices: {
        input: row.inputPricePerMTokUsd.toString(),
        cachedInput: row.cachedInputPricePerMTokUsd.toString(),
        output: row.outputPricePerMTokUsd.toString(),
      },
    };
  }

  /** Local dev and the eval script: env vars stand in for a missing PLATFORM row. */
  private fromEnv(): ResolvedAiConfig | null {
    const { AI_PROVIDER, AI_MODEL, AI_API_KEY, AI_BASE_URL } = this.config;
    if (!AI_PROVIDER || !AI_MODEL || !AI_API_KEY) return null;
    return {
      scope: 'PLATFORM',
      provider: AI_PROVIDER,
      model: AI_MODEL,
      baseUrl: AI_BASE_URL ?? null,
      apiKey: AI_API_KEY,
      prices: ZERO_PRICES,
    };
  }

  /**
   * The company's own config if it is enabled and allowed, else the platform's, else the
   * env fallback. A PLATFORM row that is switched off means off: the env does not revive it.
   * null = the assistant is off for this company.
   */
  async resolve(tenantId: string): Promise<ResolvedAiConfig | null> {
    const own = await this.tenantRow(tenantId);
    if (own?.enabled && (await this.tenantKeyAllowed(tenantId))) {
      const resolved = this.open(own);
      await this.assertBaseUrl('TENANT', resolved.baseUrl);
      return resolved;
    }
    const platform = await this.platformRow();
    if (platform) return platform.enabled ? this.open(platform) : null;
    return this.fromEnv();
  }

  /** Which provider would answer, without opening any key. For the status route. */
  async activeProvider(tenantId: string): Promise<AiProvider | null> {
    const own = await this.tenantRow(tenantId);
    if (own?.enabled && (await this.tenantKeyAllowed(tenantId))) return own.provider;
    const platform = await this.platformRow();
    if (platform) return platform.enabled ? platform.provider : null;
    return this.fromEnv()?.provider ?? null;
  }

  private async assertBaseUrl(scope: AiConfigScope, baseUrl: string | null): Promise<void> {
    if (scope === 'TENANT' && baseUrl && !isSingle(this.config)) {
      await assertPublicHttpsUrl(baseUrl);
    }
  }

  /**
   * The key to use for this input: the one entered, else the saved one, but only while
   * provider and base URL stay the same, so a stored key can never be redirected elsewhere.
   */
  private keyFor(input: AiProviderConfigInput, row: AiProviderConfig | null): string {
    if (input.apiKey) return input.apiKey;
    if (!row || row.provider !== input.provider || row.baseUrl !== input.baseUrl) {
      throw new AppException(ErrorCode.AI_KEY_REQUIRED, 'Enter the API key');
    }
    return this.open(row).apiKey;
  }

  private async save(
    db: Tx,
    scope: AiConfigScope,
    tenantId: string | null,
    row: AiProviderConfig | null,
    input: AiProviderConfigInput,
    updatedBy: string,
  ): Promise<AiProviderConfig> {
    const key = this.keyFor(input, row);
    const data = {
      provider: input.provider,
      model: input.model,
      baseUrl: input.baseUrl,
      apiKeyEncrypted: sealSecret(
        parseSecretsKey(this.config.SECRETS_ENCRYPTION_KEY),
        key,
        secretContext(scope, tenantId),
      ),
      keyHint: key.slice(-4),
      inputPricePerMTokUsd: input.inputPricePerMTokUsd,
      cachedInputPricePerMTokUsd: input.cachedInputPricePerMTokUsd,
      outputPricePerMTokUsd: input.outputPricePerMTokUsd,
      enabled: input.enabled,
      updatedBy,
    };
    return row
      ? db.aiProviderConfig.update({ where: { id: row.id }, data })
      : db.aiProviderConfig.create({ data: { ...data, scope, tenantId } });
  }

  // --- Super-admin (PLATFORM) ----------------------------------------------------------

  async platformConfig(): Promise<AiProviderConfigDto | null> {
    const row = await this.platformRow();
    return row ? toDto(row) : null;
  }

  /** `log` writes the platform journal in the same transaction. */
  async savePlatform(
    input: AiProviderConfigInput,
    adminId: string,
    log: (tx: Tx, change: { before: unknown; after: unknown; keyChanged: boolean }) => Promise<void>,
  ): Promise<AiProviderConfigDto> {
    return tenantContext.runAsSystem(async () => {
      const row = await this.platformRow();
      const saved = await this.prisma.db.$transaction(async (tx) => {
        const next = await this.save(tx, 'PLATFORM', null, row, input, adminId);
        await log(tx, {
          before: auditView(row),
          after: auditView(next),
          keyChanged: input.apiKey !== undefined,
        });
        return next;
      });
      return toDto(saved);
    });
  }

  testPlatform(input: AiProviderConfigInput): Promise<AiConfigTestResult> {
    return tenantContext.runAsSystem(async () => this.test(input, await this.platformRow()));
  }

  // --- OWNER (TENANT) ------------------------------------------------------------------

  private async assertTenantKeyAllowed(tenantId: string): Promise<void> {
    if (!(await this.tenantKeyAllowed(tenantId))) {
      throw new AppException(
        ErrorCode.AI_TENANT_KEY_NOT_ALLOWED,
        'This company cannot use its own key',
      );
    }
  }

  async tenantConfig(): Promise<AiTenantConfigResponse> {
    const tenantId = tenantContext.requireTenantId();
    const allowed = await this.tenantKeyAllowed(tenantId);
    const row = allowed ? await this.tenantRow(tenantId) : null;
    return { allowed, config: row ? toDto(row) : null };
  }

  async saveTenant(
    input: AiProviderConfigInput,
    user: CurrentUserInfo,
  ): Promise<AiProviderConfigDto> {
    const tenantId = tenantContext.requireTenantId();
    await this.assertTenantKeyAllowed(tenantId);
    await this.assertBaseUrl('TENANT', input.baseUrl);
    const row = await this.tenantRow(tenantId);
    const saved = await this.prisma.db.$transaction(async (tx) => {
      const next = await this.save(tx, 'TENANT', tenantId, row, input, user.id);
      await this.audit.log(tx, {
        action: 'AI_CONFIG_UPDATED',
        entity: 'AiProviderConfig',
        entityId: next.id,
        before: auditView(row),
        after: { ...auditView(next), keyChanged: input.apiKey !== undefined },
      });
      return next;
    });
    return toDto(saved);
  }

  async testTenant(input: AiProviderConfigInput): Promise<AiConfigTestResult> {
    const tenantId = tenantContext.requireTenantId();
    await this.assertTenantKeyAllowed(tenantId);
    await this.assertBaseUrl('TENANT', input.baseUrl);
    return this.test(input, await this.tenantRow(tenantId));
  }

  /** One tiny request with what is in the form, before anything is saved. */
  private async test(
    input: AiProviderConfigInput,
    row: AiProviderConfig | null,
  ): Promise<AiConfigTestResult> {
    const provider = this.llm.create({
      provider: input.provider,
      model: input.model,
      baseUrl: input.baseUrl,
      apiKey: this.keyFor(input, row),
    });
    const events = provider.chat({
      system: { stable: 'Answer with one word.', dynamic: 'This is a connection test.' },
      messages: [{ role: 'user', content: 'ping' }],
      tools: [],
      maxOutputTokens: 64,
    });
    for await (const event of events) {
      if (event.type === 'error') return { ok: false, code: event.code };
      if (event.type === 'done') return { ok: true, code: null };
    }
    return { ok: false, code: ErrorCode.AI_UNAVAILABLE };
  }
}
