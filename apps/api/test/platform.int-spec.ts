import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { type AuthResponse, ErrorCode, type TenantSettingsResponse } from '@erp/shared';
import {
  asTenant,
  bearer,
  createTestApp,
  registerTenant,
  type RegisteredTenant,
  type TestApp,
  uniqueEmail,
} from './helpers';

describe('health, errors, roles and tenant settings', () => {
  let t: TestApp;
  let owner: RegisteredTenant;
  let sellerToken: string;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await registerTenant(t, 'Settings SARL');
    const email = uniqueEmail('seller');
    await asTenant(owner.tenantId, async () =>
      t.prisma.db.user.create({
        data: {
          tenantId: owner.tenantId,
          email,
          passwordHash: await argon2.hash('Password123!'),
          fullName: 'Vendeur',
          role: 'SELLER',
        },
      }),
    );
    const res = await t
      .http()
      .post('/auth/login')
      .send({ email, password: 'Password123!' })
      .expect(200);
    sellerToken = (res.body as AuthResponse).accessToken;
  });
  afterAll(() => t.close());

  it('GET /health checks the database', async () => {
    const res = await t.http().get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
  });

  it('unknown routes return the standard error shape', async () => {
    const res = await t
      .http()
      .get('/nope')
      .set(...bearer(owner.auth.accessToken))
      .expect(404);
    expect(res.body).toEqual({ code: ErrorCode.NOT_FOUND, message: expect.any(String) as string });
  });

  it('an expired access token returns TOKEN_EXPIRED', async () => {
    const jwt = t.app.get(JwtService);
    const expired = await jwt.signAsync(
      { sub: owner.auth.user.id, tid: owner.tenantId, sid: 'x', role: 'OWNER' },
      { expiresIn: -10 },
    );
    const res = await t
      .http()
      .get('/auth/me')
      .set(...bearer(expired))
      .expect(401);
    expect(res.body).toMatchObject({ code: ErrorCode.TOKEN_EXPIRED });
  });

  it('every role can read settings; defaults follow docs/domain.md', async () => {
    const res = await t
      .http()
      .get('/tenant/settings')
      .set(...bearer(sellerToken))
      .expect(200);
    expect(res.body).toMatchObject({
      raisonSociale: 'Settings SARL',
      assujettiTva: true,
      creditLimitMode: 'WARN',
      negativeStockMode: 'WARN',
      priceLevelCount: 3,
      timbreEnabled: false,
    });
  });

  it('a SELLER cannot change settings (role guard)', async () => {
    const res = await t
      .http()
      .patch('/tenant/settings')
      .set(...bearer(sellerToken))
      .send({ assujettiTva: false })
      .expect(403);
    expect(res.body).toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('the OWNER updates settings; amounts are normalized and the change is audited', async () => {
    const res = await t
      .http()
      .patch('/tenant/settings')
      .set(...bearer(owner.auth.accessToken))
      .send({
        nif: '000016001234567',
        rc: '16/00-1234567B21',
        assujettiTva: false,
        negativeStockMode: 'BLOCK',
        priceLevelCount: 2,
        timbreEnabled: true,
        timbreRate: '1',
        timbreMin: '5,00',
        timbreMax: '10 000',
      })
      .expect(200);
    const s = res.body as TenantSettingsResponse;
    expect(s).toMatchObject({
      nif: '000016001234567',
      assujettiTva: false,
      negativeStockMode: 'BLOCK',
      priceLevelCount: 2,
      timbreEnabled: true,
      timbreRate: '1',
      timbreMin: '5.00',
      timbreMax: '10000.00',
      timbreThreshold: null,
    });

    const logs = await asTenant(owner.tenantId, () =>
      t.prisma.db.auditLog.findMany({ where: { action: 'TENANT_SETTINGS_UPDATED' } }),
    );
    expect(logs).toHaveLength(1);
    expect(logs[0]?.before).toMatchObject({ assujettiTva: true });
    expect(logs[0]?.after).toMatchObject({ assujettiTva: false });
    expect(logs[0]?.userId).toBe(owner.auth.user.id);
  });

  it('rejects invalid settings', async () => {
    const res = await t
      .http()
      .patch('/tenant/settings')
      .set(...bearer(owner.auth.accessToken))
      .send({ priceLevelCount: 9, tenantId: 'someone-else' })
      .expect(400);
    expect(res.body).toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });
});
