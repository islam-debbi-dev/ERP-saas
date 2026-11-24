/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- API payloads are read loosely on purpose */
export type Obj = Record<string, any>;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Tally {
  created: Record<string, number>;
  existing: Record<string, number>;
}

export function newTally(): Tally {
  return { created: {}, existing: {} };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

const THROTTLE_MS = 300;

/** One authenticated session on the API. Never logs a password or a token. */
export class Api {
  private token = '';
  constructor(
    private readonly base: string,
    private readonly identifier: string,
    private password: string,
    readonly dry: boolean,
    readonly tally: Tally,
  ) {}

  setPassword(p: string): void {
    this.password = p;
  }

  async login(): Promise<void> {
    const res = await this.raw<{ accessToken: string }>('POST', '/auth/login', {
      identifier: this.identifier,
      password: this.password,
    }, undefined, false);
    this.token = res.accessToken;
  }

  async raw<T>(
    method: string,
    path: string,
    body: unknown,
    key: string | undefined,
    auth: boolean,
  ): Promise<T> {
    let relogged = false;
    for (let attempt = 0; ; attempt++) {
      await sleep(THROTTLE_MS);
      let res: Response | undefined;
      try {
        res = await fetch(`${this.base}${path}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(auth && this.token ? { Authorization: `Bearer ${this.token}` } : {}),
            ...(key ? { 'Idempotency-Key': key } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (err) {
        // A timeout may have executed the write: retry only reads and keyed writes.
        if ((method === 'GET' || key) && attempt < 6) {
          await sleep(Math.min(1000 * 2 ** attempt, 20_000));
          continue;
        }
        throw new Error(`${method} ${path} → network error: ${(err as Error).message}`, { cause: err });
      }
      const text = await res.text();
      if (res.ok) return (text ? JSON.parse(text) : undefined) as T;
      let parsed: Obj = {};
      try {
        parsed = JSON.parse(text);
      } catch {
        /* HTML error page of the platform */
      }
      const code = parsed['code'] as string | undefined;
      if (res.status === 401 && auth && !relogged) {
        relogged = true;
        await this.login();
        continue;
      }
      const retryable =
        res.status === 429 ||
        res.status === 502 ||
        res.status === 503 ||
        res.status === 504 ||
        (res.status >= 500 && (method === 'GET' || key)) ||
        code === 'IDEMPOTENCY_REQUEST_IN_PROGRESS';
      if (retryable && attempt < 6) {
        await sleep(Math.min(1500 * 2 ** attempt, 30_000));
        continue;
      }
      throw new ApiError(res.status, code, `${method} ${path} → ${res.status} ${code ?? ''} ${(parsed['message'] as string) ?? text.slice(0, 200)}`);
    }
  }

  /** A read. In a dry run, a read that depends on a not-yet-created id gives the fallback. */
  async get<T>(path: string, fallback?: T): Promise<T> {
    if (this.dry && path.includes('dry-')) return fallback as T;
    return this.raw<T>('GET', path, undefined, undefined, true);
  }

  /** Every item of a cursor-paginated list. */
  async list<T = Obj>(path: string): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | null = null;
    const sep = path.includes('?') ? '&' : '?';
    for (;;) {
      const page: any = await this.get(`${path}${sep}limit=100${cursor ? `&cursor=${cursor}` : ''}`, {
        items: [],
        nextCursor: null,
      });
      if (Array.isArray(page)) return page as T[];
      out.push(...(page.items as T[]));
      cursor = page.nextCursor ?? null;
      if (!cursor) return out;
    }
  }

  /**
   * A write. In a dry run nothing is sent: the label is counted as "would create" and `stub`
   * (with a fake id) is returned.
   */
  async write<T = Obj>(
    label: string,
    method: 'POST' | 'PUT' | 'PATCH',
    path: string,
    body?: unknown,
    key?: string,
    stub: Obj = {},
  ): Promise<T> {
    if (this.dry) {
      this.count(label);
      return { id: `dry-${label}`, ...stub } as T;
    }
    const res = await this.raw<T>(method, path, body ?? {}, key, true);
    this.count(label);
    return res;
  }

  count(label: string): void {
    this.tally.created[label] = (this.tally.created[label] ?? 0) + 1;
  }

  already(label: string, n = 1): void {
    this.tally.existing[label] = (this.tally.existing[label] ?? 0) + n;
  }
}
