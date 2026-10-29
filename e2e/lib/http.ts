import { API } from './config.ts';

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
  raw: string;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string | null;
  idempotencyKey?: string;
  headers?: Record<string, string>;
  raw?: boolean;
  cookie?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    message: string,
  ) {
    super(message);
  }
}

/** Low-level fetch wrapper that never throws on 4xx (the caller inspects). */
export async function request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  if (opts.cookie) headers['Cookie'] = opts.cookie;

  const res = await fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    redirect: 'manual',
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const raw = buf.toString('utf8');
  let body: unknown = raw;
  if (!opts.raw) {
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      try {
        body = raw.length ? JSON.parse(raw) : null;
      } catch {
        body = raw;
      }
    } else if (ct.includes('text/')) {
      body = raw;
    }
  }
  return { status: res.status, body: body as T, headers: res.headers, raw };
}

/** Like request() but throws on non-2xx. */
export async function call<T = unknown>(path: string, opts: RequestOptions = {}): Promise<ApiResponse<T>> {
  const res = await request<T>(path, opts);
  if (res.status >= 400) {
    const code = (res.body as { code?: string })?.code ?? 'n/a';
    const message = (res.body as { message?: string })?.message ?? res.raw.slice(0, 200);
    throw new ApiError(res.status, res.body, `HTTP ${res.status} ${code} ${message} (${path})`);
  }
  return res;
}

let keyCounter = 0;
/** Idempotency keys must be 8..100 chars. */
export function idemKey(prefix: string): string {
  keyCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${keyCounter.toString(36)}`;
}

export interface Session {
  token: string;
  refreshToken: string | null;
  cookie: string | null;
  userId: string;
  tenantId: string;
  email: string;
}

export async function login(email: string, password: string): Promise<Session> {
  const res = await request<{ accessToken: string; user: { id: string; tenantId: string; email: string } }>(
    '/auth/login',
    { method: 'POST', body: { email, password }, headers: { 'X-Client-Type': 'native' } },
  );
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`login failed: HTTP ${res.status} ${res.raw.slice(0, 300)}`);
  }
  const setCookie = res.headers.get('set-cookie') ?? '';
  const m = setCookie.match(/erp_rt=([^;]+)/);
  return {
    token: res.body.accessToken,
    refreshToken: (res.body as { refreshToken?: string }).refreshToken ?? null,
    cookie: m ? `erp_rt=${m[1]}` : null,
    userId: res.body.user.id,
    tenantId: res.body.user.tenantId,
    email: res.body.user.email,
  };
}

export async function register(
  companyName: string,
  fullName: string,
  email: string,
  password: string,
  /** Picks the trial edition (phase 13b): DISTRIBUTEUR turns the sales force screens on. */
  activity?: 'GROSSISTE' | 'IMPORTATEUR' | 'DISTRIBUTEUR',
): Promise<Session> {
  const res = await request<{ accessToken: string; user: { id: string; tenantId: string; email: string } }>(
    '/auth/register',
    {
      method: 'POST',
      body: { companyName, fullName, email, password, ...(activity ? { activity } : {}) },
      headers: { 'X-Client-Type': 'native' },
    },
  );
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`register failed: HTTP ${res.status} ${res.raw.slice(0, 300)}`);
  }
  return {
    token: res.body.accessToken,
    refreshToken: (res.body as { refreshToken?: string }).refreshToken ?? null,
    cookie: null,
    userId: res.body.user.id,
    tenantId: res.body.user.tenantId,
    email: res.body.user.email,
  };
}
