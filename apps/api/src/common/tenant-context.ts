import { AsyncLocalStorage } from 'node:async_hooks';
import { ErrorCode } from '@erp/shared';
import { AppException } from './app-exception';

/**
 * Per-request context. A middleware opens an empty store for each request and the
 * auth guard fills it from the verified JWT, so the tenant always comes from the
 * token, never from the request body (AGENTS.md rule 5).
 */
export interface RequestContext {
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  deviceName?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  /**
   * Bypasses the tenant filter. Only for flows that run before a tenant is known
   * (register, login, refresh), health checks and the seed. Code using it must pass
   * tenantId explicitly.
   */
  system?: boolean;
}

const storage = new AsyncLocalStorage<RequestContext>();

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * Runs `fn` inside `ctx`. Prisma queries are lazy (they start on `.then`), so a
 * returned query is started here, inside the context, not later by the caller.
 */
function runIn<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, () => {
    const result = fn();
    return (isThenable(result) ? result.then((v) => v) : result) as T;
  });
}

export const tenantContext = {
  run<T>(ctx: RequestContext, fn: () => T): T {
    return runIn(ctx, fn);
  },

  get(): RequestContext | undefined {
    return storage.getStore();
  },

  /** Runs `fn` without tenant filtering, keeping request metadata (ip, device) for audit. */
  runAsSystem<T>(fn: () => T): T {
    return runIn({ ...storage.getStore(), system: true }, fn);
  },

  /** The current tenant id, or throws: business code must never run without one. */
  requireTenantId(): string {
    const tenantId = storage.getStore()?.tenantId;
    if (!tenantId) {
      throw new AppException(ErrorCode.TENANT_CONTEXT_MISSING, 'No tenant in the current context');
    }
    return tenantId;
  },
};
