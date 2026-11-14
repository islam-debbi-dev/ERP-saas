import { type AuditLogPage, ErrorCode } from '@erp/shared';
import { trustedProxyHops } from '../src/setup-app';
import {
  bearer,
  createTestApp,
  registerTenant,
  type RegisteredTenant,
  type TestApp,
} from './helpers';

/**
 * Audit 01 #4: reached directly (no proxy in front, TRUST_PROXY unset), the API believed
 * `X-Forwarded-For`. A caller gave each login attempt its own address, so the per-address
 * limiter never counted, and the address he invented was written to the audit log.
 */
describe('a forged X-Forwarded-For, with no trusted proxy', () => {
  let t: TestApp;
  let a: RegisteredTenant;
  const before = process.env['TRUST_PROXY'];

  beforeAll(async () => {
    // The other suites run as if behind one proxy (setup-env.ts); this one is reached directly.
    process.env['TRUST_PROXY'] = '0';
    t = await createTestApp();
    a = await registerTenant(t, 'Adresse forgée');
  });
  afterAll(async () => {
    process.env['TRUST_PROXY'] = before;
    await t.close();
  });

  const login = (identifier: string, forged: string) =>
    t
      .http()
      .post('/auth/login')
      .set('X-Forwarded-For', forged)
      .set('X-Client-Type', 'native')
      .send({ identifier, password: 'Wrong-password1!' });

  it('does not reach the audit log: the address recorded is the one of the connection', async () => {
    await login(a.email, '198.51.100.42').expect(401);
    const logs = (
      await t
        .http()
        .get('/audit-logs?limit=100')
        .set(...bearer(a.auth.accessToken))
        .expect(200)
    ).body as AuditLogPage;
    const failed = logs.items.filter((l) => l.action === 'LOGIN_FAILED');
    expect(failed).toHaveLength(1);
    expect(JSON.stringify(failed[0])).not.toContain('198.51.100.42');
    expect(JSON.stringify(failed[0])).toMatch(/127\.0\.0\.1|::1/);
  });

  it('does not bypass the login limiter: the eleventh attempt of one caller is refused', async () => {
    const codes: number[] = [];
    for (let i = 1; i <= 11; i++) {
      codes.push((await login(`ghost-${i}@test.dz`, `203.0.113.${i}`)).status);
    }
    // One attempt was already made above from the same connection.
    expect(codes.slice(0, 9)).toEqual(Array(9).fill(401));
    expect(codes.slice(9)).toEqual([429, 429]);
    const last = await login('ghost-12@test.dz', '203.0.113.200, 203.0.113.201');
    expect((last.body as { code: string }).code).toBe(ErrorCode.TOO_MANY_REQUESTS);
  });
});

describe('trustedProxyHops', () => {
  it('is TRUST_PROXY when set, else 1 on Vercel, else 0', () => {
    expect(trustedProxyHops({ TRUST_PROXY: undefined, VERCEL: undefined })).toBe(0);
    expect(trustedProxyHops({ TRUST_PROXY: undefined, VERCEL: '1' })).toBe(1);
    expect(trustedProxyHops({ TRUST_PROXY: 0, VERCEL: '1' })).toBe(0);
    expect(trustedProxyHops({ TRUST_PROXY: 2, VERCEL: undefined })).toBe(2);
  });
});
