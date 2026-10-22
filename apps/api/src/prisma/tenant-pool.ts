import pg from 'pg';
import { tenantContext } from '../common/tenant-context';

const APPLIED = Symbol('rlsSettings');

type TaggedClient = pg.PoolClient & { [APPLIED]?: string };

/** The RLS settings for the current request: tenant id, and whether the system context bypasses. */
function currentSettings(): [tenantId: string, bypass: 'on' | 'off'] {
  const ctx = tenantContext.get();
  return [ctx?.tenantId ?? '', ctx?.system ? 'on' : 'off'];
}

/**
 * Postgres Row-Level Security, second line of tenant isolation after the Prisma
 * extension. Every connection handed out (to a query or a transaction) first gets
 * `app.tenant_id` / `app.rls_bypass` from the request context, which the policies of
 * the `row_level_security` migration compare with each row's tenantId.
 *
 * Session-level settings (not SET LOCAL) because most queries run outside an explicit
 * transaction. They're overwritten on every checkout, so nothing carries over from the
 * previous request, and skipped when the connection already holds the same values.
 * RLS only binds a role that is neither the owner nor a superuser (erp_app).
 */
export class TenantAwarePool extends pg.Pool {
  override connect(): Promise<pg.PoolClient>;
  override connect(
    callback: (
      err: Error | undefined,
      client: pg.PoolClient | undefined,
      done: (release?: unknown) => void,
    ) => void,
  ): void;
  override connect(
    callback?: (
      err: Error | undefined,
      client: pg.PoolClient | undefined,
      done: (release?: unknown) => void,
    ) => void,
  ): Promise<pg.PoolClient> | void {
    const settings = currentSettings();
    const ready = this.checkout(settings);
    if (!callback) return ready;
    ready.then(
      (client) => callback(undefined, client, (err) => client.release(err as Error | undefined)),
      (err: Error) => callback(err, undefined, () => undefined),
    );
  }

  // pg-pool's own query() goes through the callback form of connect(); route it through
  // checkout() instead so pool.query() gets the same settings.
  override query(...args: unknown[]): never {
    const settings = currentSettings();
    const run = async (): Promise<unknown> => {
      const client = await this.checkout(settings);
      try {
        const result: unknown = await (client.query as (...a: unknown[]) => Promise<unknown>)(
          ...args,
        );
        client.release();
        return result;
      } catch (err) {
        client.release();
        throw err;
      }
    };
    return run() as never;
  }

  private async checkout([tenantId, bypass]: [string, 'on' | 'off']): Promise<pg.PoolClient> {
    const client = (await super.connect()) as TaggedClient;
    const key = `${tenantId}|${bypass}`;
    if (client[APPLIED] === key) return client;
    try {
      await client.query(
        "SELECT set_config('app.tenant_id', $1, false), set_config('app.rls_bypass', $2, false)",
        [tenantId, bypass],
      );
    } catch (err) {
      client.release(err as Error);
      throw err;
    }
    client[APPLIED] = key;
    return client;
  }
}
