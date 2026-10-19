import type { ApiError as ApiErrorBody, AuthResponse } from '@erp/shared';
import { sessionHint } from './session-hint';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Error codes on a 401 that a token refresh can fix. */
const REFRESHABLE = new Set(['TOKEN_EXPIRED', 'UNAUTHENTICATED', 'INVALID_TOKEN']);

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Required by the API on POSTs that create money or stock effects. */
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** `blob` for files (PDF); errors still come back as JSON. */
  as?: 'json' | 'blob';
}

export interface ApiClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  /** Called once when the session is definitely over (refresh failed). */
  onSessionEnd?: (reason: ApiError) => void;
}

/**
 * Fetch wrapper. The access token lives in memory only; the refresh token is an
 * httpOnly cookie the browser sends to /auth/refresh.
 *
 * When several requests hit an expired token at once, exactly one refresh runs and
 * the others wait for it, then each retries once. Two parallel refreshes would send
 * the same refresh token twice, which the API treats as theft and revokes the session.
 */
export class ApiClient {
  private accessToken: string | null = null;
  private refreshing: Promise<AuthResponse> | null = null;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: ApiClientOptions) {
    this.fetchFn = options.fetch ?? ((...args) => fetch(...args));
  }

  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  hasAccessToken(): boolean {
    return this.accessToken !== null;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    // After a page reload there is no token in memory yet: get one from the cookie first.
    if (!this.accessToken && !path.startsWith('/auth/')) await this.refresh();

    const tokenUsed = this.accessToken;
    try {
      return await this.send<T>(path, options);
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 401 || !REFRESHABLE.has(err.code)) throw err;
      if (path.startsWith('/auth/') && path !== '/auth/me' && path !== '/auth/logout') throw err;
      // Another request may already have refreshed while this one was in flight.
      if (this.accessToken === tokenUsed) await this.refresh();
      return this.send<T>(path, options);
    }
  }

  /** A file (PDF…) with the same token and refresh handling as `request`. */
  download(path: string, options: Pick<RequestOptions, 'signal'> = {}): Promise<Blob> {
    return this.request<Blob>(path, { ...options, as: 'blob' });
  }

  /** Single in-flight refresh shared by every caller. */
  refresh(): Promise<AuthResponse> {
    if (!this.refreshing) {
      this.refreshing = this.send<AuthResponse>('/auth/refresh', { method: 'POST', body: {} })
        .then((auth) => {
          this.accessToken = auth.accessToken;
          return auth;
        })
        .catch((err: unknown) => {
          this.accessToken = null;
          const apiErr =
            err instanceof ApiError ? err : new ApiError(0, 'NETWORK', 'Network error');
          // A network failure is not a logout: keep the session, let the caller retry.
          if (apiErr.status === 401) this.options.onSessionEnd?.(apiErr);
          throw apiErr;
        })
        .finally(() => {
          this.refreshing = null;
        });
    }
    return this.refreshing;
  }

  private async send<T>(path: string, options: RequestOptions): Promise<T> {
    const headers: Record<string, string> = {
      Accept: options.as === 'blob' ? '*/*' : 'application/json',
    };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.accessToken) headers['Authorization'] = `Bearer ${this.accessToken}`;
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

    let res: Response;
    try {
      res = await this.fetchFn(`${this.options.baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        credentials: 'include',
        signal: options.signal,
      });
    } catch {
      throw new ApiError(0, 'NETWORK', 'Network error');
    }

    if (res.status === 204) return undefined as T;
    if (res.ok && options.as === 'blob') return (await res.blob()) as T;
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const body = (data ?? {}) as Partial<ApiErrorBody>;
      throw new ApiError(
        res.status,
        body.code ?? 'INTERNAL_ERROR',
        body.message ?? res.statusText,
        body.details,
      );
    }
    return data as T;
  }
}

export const api = new ApiClient({
  baseUrl: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001',
  onSessionEnd: () => {
    sessionHint.set(false);
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      // Full reload on purpose: drops every in-memory query and token of the old session.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign('/login?expired=1');
    }
  },
});
