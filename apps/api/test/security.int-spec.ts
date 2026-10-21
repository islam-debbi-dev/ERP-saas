import { createTestApp, type TestApp } from './helpers';

/** HTTP hardening: security headers, body size limit, rate limits, request id in errors. */
describe('HTTP security', () => {
  let t: TestApp;
  const saved = { ...process.env };

  beforeAll(async () => {
    process.env['RATE_LIMIT_PER_MINUTE'] = '20';
    process.env['RATE_LIMIT_AUTH_PER_MINUTE'] = '5';
    t = await createTestApp();
  });

  afterAll(async () => {
    process.env = saved;
    await t.close();
  });

  it('sends security headers', async () => {
    const res = await t.http().get('/health').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toMatch(/max-age=/);
    expect(res.headers['content-security-policy']).toMatch(/default-src 'none'|default-src 'self'/);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.body).toMatchObject({
      status: 'ok',
      db: 'up',
      version: expect.any(String) as string,
    });
  });

  it('only allows the web origin', async () => {
    const res = await t.http().get('/health').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('puts the request id in error bodies, matching the header', async () => {
    const res = await t.http().get('/clients').set('X-Request-Id', 'req-test-123').expect(401);
    expect(res.headers['x-request-id']).toBe('req-test-123');
    expect(res.body).toMatchObject({ code: 'UNAUTHENTICATED', requestId: 'req-test-123' });
  });

  it('refuses a JSON body over 1 MB', async () => {
    const res = await t
      .http()
      .post('/auth/register')
      .set('X-Forwarded-For', '10.9.0.1')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ companyName: 'x'.repeat(1_100_000) }));
    expect(res.status).toBe(413);
  });

  it('rate limits the auth routes harder than the rest', async () => {
    const ip = '10.9.0.2';
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await t.http().post('/auth/refresh').set('X-Forwarded-For', ip).send({});
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5)).not.toContain(429);
    expect(statuses.slice(5)).toEqual([429, 429]);
    // Another IP is not affected.
    const other = await t.http().post('/auth/refresh').set('X-Forwarded-For', '10.9.0.3').send({});
    expect(other.status).not.toBe(429);
  });

  it('rate limits every route per IP, but never /health', async () => {
    const ip = '10.9.0.4';
    let last = 0;
    for (let i = 0; i < 21; i++) {
      last = (await t.http().get('/clients').set('X-Forwarded-For', ip)).status;
    }
    expect(last).toBe(429);
    const limited = await t.http().get('/clients').set('X-Forwarded-For', ip).expect(429);
    expect(limited.body).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    await t.http().get('/health').set('X-Forwarded-For', ip).expect(200);
  });
});
