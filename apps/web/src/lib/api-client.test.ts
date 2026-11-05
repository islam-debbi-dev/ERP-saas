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

  it('never refreshes a fixed (support view) token: a 401 ends the view', async () => {
    const fake = fakeApi();
    const onSessionEnd = vi.fn();
    const client = new ApiClient({ baseUrl: 'http://api', fetch: fake.fetchFn, onSessionEnd });
    client.useFixedToken('t1');
    await expect(client.request('/a')).resolves.toBeDefined();
    client.useFixedToken('t0');
    await expect(client.request('/b')).rejects.toBeInstanceOf(ApiError);
    expect(fake.calls.refresh).toBe(0);
    expect(onSessionEnd).toHaveBeenCalledTimes(1);
  });

  it('uses its own auth routes (super-admin client)', async () => {
    const paths: string[] = [];
    const fetchFn = vi.fn((url: string) => {
      paths.push(url.replace('http://api', ''));
      return Promise.resolve(json(200, { accessToken: 'a1', expiresIn: 900, admin: {} }));
    }) as unknown as typeof fetch;
    const client = new ApiClient({
      baseUrl: 'http://api',
      fetch: fetchFn,
      authPath: '/admin/auth',
    });
    await client.request('/admin/tenants');
    expect(paths).toEqual(['/admin/auth/refresh', '/admin/tenants']);
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

  it('sends FormData as multipart, untouched and without a JSON content type', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(json(200, { ok: true })));
    const client = new ApiClient({ baseUrl: 'http://api', fetch: fetchFn });
    client.setAccessToken('t1');
    const form = new FormData();
    form.append('file', new Blob(['a;b']), 'clients.csv');
    await client.request('/imports/CLIENTS/preview', { method: 'POST', body: form });
    const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.body).toBe(form);
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('downloads a file as a Blob after refreshing an expired token', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json(401, { code: 'TOKEN_EXPIRED', message: 'expired' }))
      .mockResolvedValueOnce(json(200, { accessToken: 't2', user: {} }))
      .mockResolvedValueOnce(
        new Response('%PDF-1.7', { status: 200, headers: { 'Content-Type': 'application/pdf' } }),
      );
    const client = new ApiClient({ baseUrl: 'http://api', fetch: fetchFn as typeof fetch });
    client.setAccessToken('t1');
    const blob = await client.download('/documents/FAC/x/pdf');
    expect(await blob.text()).toBe('%PDF-1.7');
    expect(fetchFn.mock.calls[2]![0]).toBe('http://api/documents/FAC/x/pdf');
  });

  it('a failed download rejects with the API error, not a broken file', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(json(404, { code: 'NOT_FOUND', message: 'no' })));
    const client = new ApiClient({ baseUrl: 'http://api', fetch: fetchFn });
    client.setAccessToken('t1');
    await expect(client.download('/documents/BL/x/pdf')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it('maps network failures to a NETWORK error without ending the session', async () => {
    const onSessionEnd = vi.fn();
    const fetchFn = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    const client = new ApiClient({ baseUrl: 'http://api', fetch: fetchFn, onSessionEnd });
    await expect(client.request('/a')).rejects.toMatchObject({ code: 'NETWORK' });
    expect(onSessionEnd).not.toHaveBeenCalled();
  });
});

describe('ApiClient stream', () => {
  const sse = (...chunks: string[]) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
          controller.close();
        },
      }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    );

  it('hands over each event, even split across chunks or in the middle of a letter', async () => {
    const bytes = new TextEncoder().encode('data: {"t":"سلام"}\n\n');
    const fetchFn = vi.fn(() =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes.slice(0, 12));
              controller.enqueue(bytes.slice(12));
              controller.enqueue(new TextEncoder().encode('data: {"n":1}\n\ndata: {"n":'));
              controller.enqueue(new TextEncoder().encode('2}\n\n'));
              controller.close();
            },
          }),
          { status: 200 },
        ),
      ),
    ) as unknown as typeof fetch;
    const client = new ApiClient({ baseUrl: 'http://api', fetch: fetchFn });
    client.setAccessToken('t1');
    const seen: string[] = [];
    await client.stream('/chat', { body: {} }, (data) => seen.push(data));
    expect(seen).toEqual(['{"t":"سلام"}', '{"n":1}', '{"n":2}']);
  });

  it('refreshes an expired token once, then streams', async () => {
    let generation = 1;
    const fetchFn = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/auth/refresh')) {
        generation += 1;
        return Promise.resolve(
          json(200, { accessToken: `t${generation}`, expiresIn: 900, user: {} }),
        );
      }
      const auth = (init?.headers as Record<string, string>)['Authorization'];
      return Promise.resolve(
        auth === `Bearer t${generation}`
          ? sse('data: ok\n\n')
          : json(401, { code: 'TOKEN_EXPIRED', message: 'expired' }),
      );
    }) as unknown as typeof fetch;
    const client = new ApiClient({ baseUrl: 'http://api', fetch: fetchFn });
    client.setAccessToken('t0');
    const seen: string[] = [];
    await client.stream('/chat', { body: {} }, (data) => seen.push(data));
    expect(seen).toEqual(['ok']);
  });

  it('throws the API error before the first byte, with its details', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(
        json(429, {
          code: 'AI_QUOTA_EXCEEDED',
          message: 'quota',
          details: { resetDate: '2026-12-01' },
        }),
      ),
    ) as unknown as typeof fetch;
    const client = new ApiClient({ baseUrl: 'http://api', fetch: fetchFn });
    client.setAccessToken('t1');
    const failure: unknown = await client
      .stream('/chat', { body: {} }, () => undefined)
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      code: 'AI_QUOTA_EXCEEDED',
      details: { resetDate: '2026-12-01' },
    });
  });
});
