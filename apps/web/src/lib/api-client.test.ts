import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from './api-client';

function json(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Fake API: access token "tN" is valid only for the current N; refresh bumps N. */
function fakeApi(opts: { refreshFails?: boolean; refreshDelayMs?: number } = {}) {
  let generation = 1;
  const calls = { refresh: 0, data: 0 };
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace('http://api', '');
    const auth = (init?.headers as Record<string, string>)['Authorization'];
    if (path === '/auth/refresh') {
      calls.refresh += 1;
      await new Promise((r) => setTimeout(r, opts.refreshDelayMs ?? 5));
      if (opts.refreshFails) return json(401, { code: 'SESSION_REVOKED', message: 'revoked' });
      generation += 1;
      return json(200, { accessToken: `t${generation}`, expiresIn: 900, user: {} });
    }
    calls.data += 1;
    if (auth !== `Bearer t${generation}`) {
      return json(401, { code: 'TOKEN_EXPIRED', message: 'expired' });
    }
    return json(200, { path, token: auth });
  });
  // The fake only handles string URLs, which is all ApiClient sends.
  return { fetchFn: fetchFn as unknown as typeof fetch, calls };
}

describe('ApiClient token refresh', () => {
  it('runs a single refresh for many concurrent 401s, then retries each request once', async () => {
    const fake = fakeApi({ refreshDelayMs: 20 });
    const client = new ApiClient({ baseUrl: 'http://api', fetch: fake.fetchFn });
    client.setAccessToken('t0'); // stale token

    const results = await Promise.all(
      ['/a', '/b', '/c', '/d', '/e'].map((p) => client.request<{ path: string; token: string }>(p)),
    );

    expect(fake.calls.refresh).toBe(1);
    expect(results.map((r) => r.path)).toEqual(['/a', '/b', '/c', '/d', '/e']);
    expect(results.every((r) => r.token === 'Bearer t2')).toBe(true);
  });

  it('gets a token from the refresh cookie before the first request (page reload)', async () => {
    const fake = fakeApi();
    const client = new ApiClient({ baseUrl: 'http://api', fetch: fake.fetchFn });
    const [a, b] = await Promise.all([client.request('/a'), client.request('/b')]);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(fake.calls.refresh).toBe(1);
    expect(fake.calls.data).toBe(2);
  });

  it('ends the session once and rejects all waiting requests when refresh fails', async () => {
    const fake = fakeApi({ refreshFails: true });
    const onSessionEnd = vi.fn();
    const client = new ApiClient({
      baseUrl: 'http://api',
      fetch: fake.fetchFn,
      onSessionEnd,
    });
    client.setAccessToken('t0');

    const results = await Promise.allSettled([client.request('/a'), client.request('/b')]);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    const reason = (results[0] as PromiseRejectedResult).reason as ApiError;
    expect(reason).toBeInstanceOf(ApiError);
    expect(reason.code).toBe('SESSION_REVOKED');
    expect(fake.calls.refresh).toBe(1);
    expect(onSessionEnd).toHaveBeenCalledTimes(1);
    expect(client.hasAccessToken()).toBe(false);
  });

  it('does not refresh on errors other than an expired token', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(json(403, { code: 'FORBIDDEN', message: 'no' })));
    const client = new ApiClient({ baseUrl: 'http://api', fetch: fetchFn });
    client.setAccessToken('t1');
    await expect(client.request('/x')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('sends the Idempotency-Key header and the cookie credentials', async () => {
    const fetchFn = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(json(201, { ok: true })),
    );
    const client = new ApiClient({ baseUrl: 'http://api', fetch: fetchFn as typeof fetch });
    client.setAccessToken('t1');
    await client.request('/sales', {
      method: 'POST',
      body: { a: 1 },
      idempotencyKey: 'key-12345678',
    });
    const init = fetchFn.mock.calls[0]![1];
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('key-12345678');
    expect(init.credentials).toBe('include');
  });

  it('maps network failures to a NETWORK error without ending the session', async () => {
    const onSessionEnd = vi.fn();
    const fetchFn = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    const client = new ApiClient({ baseUrl: 'http://api', fetch: fetchFn, onSessionEnd });
    await expect(client.request('/a')).rejects.toMatchObject({ code: 'NETWORK' });
    expect(onSessionEnd).not.toHaveBeenCalled();
  });
});
