import pg from 'pg';
import { tenantContext } from '../src/common/tenant-context';
import {
  asTenant,
  bearer,
  createTestApp,
  registerTenant,
  type RegisteredTenant,
  type TestApp,
} from './helpers';
import { loadTestEnv } from './load-test-env';

/**
 * Postgres Row-Level Security, the second line of tenant isolation: even SQL that
 * forgets its tenantId filter (or code that bypasses the Prisma extension) only sees
 * the rows of the tenant set on the connection, and nothing without one.
 */
describe('row-level security', () => {
  const urls = loadTestEnv();
  let t: TestApp;
  let a: RegisteredTenant;
  let b: RegisteredTenant;
  let app: pg.Client;

  const createClient = async (who: RegisteredTenant, code: string) =>
    t
      .http()
      .post('/clients')
      .set(...bearer(who.auth.accessToken))
      .send({ code, name: `Client ${code}` })
      .expect(201);

  const count = async (c: pg.Client, table: string): Promise<number> => {
    const res = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`);
    return Number(res.rows[0]!.n);
  };

  beforeAll(async () => {
    t = await createTestApp();
    a = await registerTenant(t, 'RLS A');
    b = await registerTenant(t, 'RLS B');
    await createClient(a, 'RA1');
    await createClient(a, 'RA2');
    await createClient(b, 'RB1');
    app = new pg.Client({ connectionString: urls.app });
    await app.connect();
  });

  afterAll(async () => {
    await app.end();
    await t.close();
  });

  it('runs the app as a role that RLS binds', async () => {
    const res = await app.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    expect(res.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('every table with a tenantId column has RLS on and the tenant_isolation policy', async () => {
    // Super-admin tables: their tenantId is only a reference, tenants never see them.
    const SYSTEM_ONLY = new Set(['platform_audit_logs']);
    const res = await app.query<{ table: string; rls: boolean; policies: string[] }>(
      `SELECT c.relname AS table, c.relrowsecurity AS rls,
              COALESCE((SELECT array_agg(p.policyname::text ORDER BY p.policyname) FROM pg_policies p
                        WHERE p.schemaname = n.nspname AND p.tablename = c.relname), '{}') AS policies
       FROM information_schema.columns col
       JOIN pg_namespace n ON n.nspname = col.table_schema
       JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = col.table_name
       WHERE col.table_schema = current_schema() AND col.column_name = 'tenantId'
         AND c.relkind IN ('r', 'p')
       ORDER BY c.relname`,
    );
    expect(res.rows.length).toBeGreaterThan(40);
    // A new business table without its policy fails here, not in production.
    const missing = res.rows
      .filter(
        (r) =>
          !r.rls ||
          !r.policies.includes(SYSTEM_ONLY.has(r.table) ? 'system_only' : 'tenant_isolation'),
      )
      .map((r) => r.table);
    expect(missing).toEqual([]);
  });

  it('returns nothing without a tenant setting', async () => {
    for (const table of [
      'tenants',
      'users',
      'clients',
      'client_balances',
      'sessions',
      'audit_logs',
    ]) {
      expect(await count(app, table)).toBe(0);
    }
  });

  it('refuses a write without a tenant setting, even with a valid tenantId', async () => {
    await expect(
      app.query(
        `INSERT INTO clients (id, "tenantId", code, name, "updatedAt")
         VALUES (gen_random_uuid(), $1, 'RX', 'Intrus', now())`,
        [a.tenantId],
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("shows only the set tenant's rows, and refuses writes into another tenant", async () => {
    await app.query("SELECT set_config('app.tenant_id', $1, false)", [a.tenantId]);
    try {
      expect(await count(app, 'clients')).toBe(2);
      expect(await count(app, 'tenants')).toBe(1);
      const other = await app.query('SELECT id FROM clients WHERE "tenantId" = $1', [b.tenantId]);
      expect(other.rowCount).toBe(0);
      await expect(
        app.query(
          `INSERT INTO clients (id, "tenantId", code, name, "updatedAt")
           VALUES (gen_random_uuid(), $1, 'RX', 'Intrus', now())`,
          [b.tenantId],
        ),
      ).rejects.toThrow(/row-level security/);
      // Updating B's rows silently matches nothing.
      const upd = await app.query('UPDATE clients SET name = $1 WHERE "tenantId" = $2', [
        'pwned',
        b.tenantId,
      ]);
      expect(upd.rowCount).toBe(0);
    } finally {
      await app.query("SELECT set_config('app.tenant_id', '', false)");
    }
  });

  it('subscriptions follow the tenant; super-admin tables stay hidden from tenants', async () => {
    await app.query("SELECT set_config('app.tenant_id', $1, false)", [a.tenantId]);
    try {
      expect(await count(app, 'subscriptions')).toBe(1);
      const other = await app.query('SELECT id FROM subscriptions WHERE "tenantId" = $1', [
        b.tenantId,
      ]);
      expect(other.rowCount).toBe(0);
      for (const table of ['platform_admins', 'platform_admin_sessions', 'platform_audit_logs']) {
        expect(await count(app, table)).toBe(0);
      }
      await expect(
        app.query(
          `INSERT INTO platform_admins (id, email, "fullName", "passwordHash", "totpSecret", "updatedAt")
           VALUES (gen_random_uuid(), 'intrus@x.dz', 'Intrus', 'x', 'x', now())`,
        ),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await app.query("SELECT set_config('app.tenant_id', '', false)");
    }
  });

  it("limits raw SQL from the API to the request's tenant", async () => {
    // No tenantId filter on purpose: RLS is what keeps B's client out.
    const rows = await asTenant(
      a.tenantId,
      () => t.prisma.db.$queryRaw<{ code: string }[]>`SELECT code FROM clients ORDER BY code`,
    );
    expect(rows.map((r) => r.code)).toEqual(['RA1', 'RA2']);

    const inB = await asTenant(
      b.tenantId,
      () => t.prisma.db.$queryRaw<{ code: string }[]>`SELECT code FROM clients ORDER BY code`,
    );
    expect(inB.map((r) => r.code)).toEqual(['RB1']);
  });

  it('applies the setting inside transactions too', async () => {
    const codes = await asTenant(b.tenantId, () =>
      t.prisma.db.$transaction(
        (tx) => tx.$queryRaw<{ code: string }[]>`SELECT code FROM clients ORDER BY code`,
      ),
    );
    expect(codes.map((r) => r.code)).toEqual(['RB1']);
  });

  it('does not carry a tenant over to a query made without one', async () => {
    await asTenant(a.tenantId, () => t.prisma.db.$queryRaw`SELECT 1 FROM clients`);
    // Same pool, likely the same connection: the previous tenant must not leak.
    for (let i = 0; i < 5; i++) {
      const rows = await t.prisma.db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM clients`;
      expect(rows[0]!.n).toBe(0n);
    }
  });

  it('lets the system context (login, register) through', async () => {
    const rows = await tenantContext.runAsSystem(
      () =>
        t.prisma.db.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM clients WHERE "tenantId" IN (${a.tenantId}::uuid, ${b.tenantId}::uuid)`,
    );
    expect(rows[0]!.n).toBe(3n);
    await t.http().post('/auth/login').send({ email: a.email, password: a.password }).expect(200);
  });
});
