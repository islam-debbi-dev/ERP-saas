import * as argon2 from 'argon2';
import { ErrorCode } from '@erp/shared';
import { tenantContext } from '../src/common/tenant-context';
import {
  asTenant,
  bearer,
  createTestApp,
  registerTenant,
  type RegisteredTenant,
  type TestApp,
  uniqueEmail,
} from './helpers';

describe('tenant isolation (Prisma extension)', () => {
  let t: TestApp;
  let a: RegisteredTenant;
  let b: RegisteredTenant;

  beforeAll(async () => {
    t = await createTestApp();
    a = await registerTenant(t, 'Tenant A');
    b = await registerTenant(t, 'Tenant B');
  });
  afterAll(() => t.close());

  it('tenant A cannot read tenant B users', async () => {
    const users = await asTenant(a.tenantId, () => t.prisma.db.user.findMany());
    expect(users.map((u) => u.tenantId)).toEqual([a.tenantId]);

    const bUser = await asTenant(a.tenantId, () =>
      t.prisma.db.user.findUnique({ where: { id: b.auth.user.id } }),
    );
    expect(bUser).toBeNull();

    const byEmail = await asTenant(a.tenantId, () =>
      t.prisma.db.user.findFirst({ where: { email: b.email } }),
    );
    expect(byEmail).toBeNull();
  });

  it('a tenantId passed in the query is overridden by the context tenant', async () => {
    const users = await asTenant(a.tenantId, () =>
      t.prisma.db.user.findMany({ where: { tenantId: b.tenantId } }),
    );
    expect(users.every((u) => u.tenantId === a.tenantId)).toBe(true);
  });

  it('tenant A cannot update or delete tenant B rows', async () => {
    const updated = await asTenant(a.tenantId, () =>
      t.prisma.db.user.updateMany({ where: { id: b.auth.user.id }, data: { fullName: 'Hacked' } }),
    );
    expect(updated.count).toBe(0);

    await expect(
      asTenant(a.tenantId, () =>
        t.prisma.db.user.update({ where: { id: b.auth.user.id }, data: { fullName: 'Hacked' } }),
      ),
    ).rejects.toThrow();

    const revoked = await asTenant(a.tenantId, () =>
      t.prisma.db.session.updateMany({
        where: { userId: b.auth.user.id },
        data: { revokedAt: new Date() },
      }),
    );
    expect(revoked.count).toBe(0);

    const bUser = await asTenant(b.tenantId, () =>
      t.prisma.db.user.findUniqueOrThrow({ where: { id: b.auth.user.id } }),
    );
    expect(bUser.fullName).toBe('Owner Test');
  });

  it('creates are stamped with the context tenant, whatever the input says', async () => {
    const user = await asTenant(a.tenantId, async () =>
      t.prisma.db.user.create({
        data: {
          tenantId: b.tenantId,
          email: uniqueEmail('seller'),
          passwordHash: await argon2.hash('x'),
          fullName: 'Seller',
          role: 'SELLER',
        },
      }),
    );
    expect(user.tenantId).toBe(a.tenantId);
  });

  it('the Tenant model only exposes the context tenant row', async () => {
    const tenants = await asTenant(a.tenantId, () => t.prisma.db.tenant.findMany());
    expect(tenants.map((x) => x.id)).toEqual([a.tenantId]);
  });

  it('fails closed when there is no tenant in context', async () => {
    await expect(t.prisma.db.user.findMany()).rejects.toMatchObject({
      code: ErrorCode.TENANT_CONTEXT_MISSING,
    });
    await expect(tenantContext.run({}, () => t.prisma.db.session.count())).rejects.toMatchObject({
      code: ErrorCode.TENANT_CONTEXT_MISSING,
    });
  });

  it('audit logs cannot be updated or deleted', async () => {
    await expect(asTenant(a.tenantId, () => t.prisma.db.auditLog.deleteMany({}))).rejects.toThrow(
      /append-only/,
    );
    await expect(
      asTenant(a.tenantId, () => t.prisma.db.auditLog.updateMany({ data: { action: 'X' } })),
    ).rejects.toThrow(/append-only/);
  });

  it('over HTTP, tenant A cannot revoke a session of tenant B', async () => {
    const bSessions = await t
      .http()
      .get('/auth/sessions')
      .set(...bearer(b.auth.accessToken))
      .expect(200);
    const bSessionId = (bSessions.body as { id: string }[])[0]?.id;
    expect(bSessionId).toBeDefined();

    const res = await t
      .http()
      .delete(`/auth/sessions/${bSessionId}`)
      .set(...bearer(a.auth.accessToken))
      .expect(404);
    expect(res.body).toMatchObject({ code: ErrorCode.NOT_FOUND });

    await t
      .http()
      .get('/auth/me')
      .set(...bearer(b.auth.accessToken))
      .expect(200);
  });

  it('over HTTP, settings are those of the token tenant', async () => {
    const res = await t
      .http()
      .get('/tenant/settings')
      .set(...bearer(a.auth.accessToken))
      .expect(200);
    expect(res.body).toMatchObject({ tenantId: a.tenantId, name: 'Tenant A' });
  });
});
