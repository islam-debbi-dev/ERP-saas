/**
 * Shared pieces of audit 02: the guard that keeps the suite on its own database, a
 * super-admin, a company with every module on, and exact money assertions.
 *
 * Everything goes through the real API. The database is only read, except where a check
 * needs a row dated in the past (a month already closed): those writes are marked
 * `backdate` and only ever run on a local `erp_audit02*` database.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Decimal from 'decimal.js';
import { ARTIFACTS, DB } from './config.ts';
import { query } from './db.ts';
import { assert } from './harness.ts';
import { call, idemKey, register, request, type ApiResponse, type Session } from './http.ts';
import { totp } from './totp.ts';

export const PASSWORD = 'Audit1234!';
export const OUT = `${ARTIFACTS}audit-02/`;
const ADMIN_FILE = fileURLToPath(new URL('../.auth/audit02-admin.json', import.meta.url));

/** The suite writes to the database it points at: never the dev one, never a remote one. */
export function assertAuditDb(url: string = DB): void {
  const u = new URL(url);
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (!local || !u.pathname.startsWith('/erp_audit02')) {
    throw new Error(
      `Refusing to run on ${u.hostname}${u.pathname}: set DB to a local erp_audit02* database ` +
        '(see e2e/REPORT-02.md, "How to reproduce")',
    );
  }
}

export function proof(file: string, content: string): string {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}${file}`, content);
  return `e2e/artifacts/audit-02/${file}`;
}

// ---------------------------------------------------------------- money

/** Exact comparison of two decimal strings (money, quantity, cost). Never a JS number. */
export function same(actual: unknown, expected: string | Decimal, what: string): void {
  let a: Decimal;
  try {
    a = new Decimal(String(actual));
  } catch {
    throw new Error(`${what}: expected ${String(expected)}, got ${JSON.stringify(actual)}`);
  }
  const e = new Decimal(expected);
  if (!a.eq(e)) throw new Error(`${what}: expected ${e.toString()}, got ${a.toString()}`);
}

export const D = (v: string | number | Decimal): Decimal => new Decimal(v);

// ---------------------------------------------------------------- dates (Algiers = UTC+1, no DST)

const pad = (n: number): string => String(n).padStart(2, '0');
export function algiersToday(): string {
  return new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
}
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function monthOf(day: string): string {
  return day.slice(0, 7);
}
export function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
}
export function monthDays(month: string): string[] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${pad(i + 1)}`);
}
export const weekday = (day: string): number => new Date(`${day}T00:00:00Z`).getUTCDay();

// ---------------------------------------------------------------- API client

/** A caller: one user's token, with an Idempotency-Key on every write unless told otherwise. */
export class Api {
  constructor(
    readonly token: string,
    readonly label = 'user',
  ) {}

  get<T = unknown>(path: string): Promise<ApiResponse<T>> {
    return request<T>(path, { token: this.token });
  }

  /** GET that must succeed. */
  async read<T = unknown>(path: string): Promise<T> {
    return (await call<T>(path, { token: this.token })).body;
  }

  send<T = unknown>(
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body: unknown = {},
    key: string | null = idemKey('a2'),
  ): Promise<ApiResponse<T>> {
    return request<T>(path, {
      method,
      token: this.token,
      body,
      ...(key ? { idempotencyKey: key } : {}),
    });
  }

  /** Write that must succeed; returns the body. */
  async ok<T = unknown>(
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body: unknown = {},
    key: string | null = idemKey('a2'),
  ): Promise<T> {
    const res = await this.send<T>(method, path, body, key);
    if (res.status >= 400) {
      throw new Error(
        `${this.label} ${method} ${path} -> HTTP ${res.status} ${res.raw.slice(0, 400)}`,
      );
    }
    return res.body;
  }

  post<T = unknown>(path: string, body: unknown = {}, key?: string | null): Promise<T> {
    return this.ok<T>('POST', path, body, key === undefined ? idemKey('a2') : key);
  }
  put<T = unknown>(path: string, body: unknown = {}): Promise<T> {
    return this.ok<T>('PUT', path, body, null);
  }
  patch<T = unknown>(path: string, body: unknown = {}): Promise<T> {
    return this.ok<T>('PATCH', path, body, null);
  }
}

// ---------------------------------------------------------------- super-admin

interface AdminCreds {
  email: string;
  password: string;
  secret: string;
  db: string;
}

/** One super-admin per audit database, created with the repo's own CLI and kept in .auth/. */
function adminCreds(): AdminCreds {
  if (existsSync(ADMIN_FILE)) {
    const saved = JSON.parse(readFileSync(ADMIN_FILE, 'utf8')) as AdminCreds;
    if (saved.db === DB) return saved;
  }
  const email = `audit02-admin-${Date.now().toString(36)}@platform.dz`;
  const out = execFileSync('pnpm', ['--filter', '@erp/api', 'admin:create', '--email', email], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    encoding: 'utf8',
    // The CLI reads apps/api/.env (the dev database): point it at the audit database.
    env: { ...process.env, DATABASE_URL_MIGRATE: DB, DATABASE_URL: DB },
  });
  const password = /Password \(shown once\):\s+(\S+)/.exec(out)?.[1];
  const secret = /TOTP secret:\s+(\S+)/.exec(out)?.[1];
  if (!password || !secret) throw new Error(`admin:create gave no credentials:\n${out}`);
  const creds = { email, password, secret, db: DB };
  mkdirSync(fileURLToPath(new URL('../.auth/', import.meta.url)), { recursive: true });
  writeFileSync(ADMIN_FILE, JSON.stringify(creds, null, 2));
  return creds;
}

let adminTok: string | null = null;
export async function adminToken(): Promise<string> {
  if (adminTok) return adminTok;
  const a = adminCreds();
  const res = await call<{ accessToken: string }>('/admin/auth/login', {
    method: 'POST',
    body: { email: a.email, password: a.password, code: totp(a.secret) },
  });
  adminTok = res.body.accessToken;
  return adminTok;
}

// ---------------------------------------------------------------- a company with every module

export interface Company {
  session: Session;
  tenantId: string;
  owner: Api;
  units: Record<string, string>;
  levels: string[];
  mainWarehouseId: string;
}

let seq = 0;
export const uniq = (prefix: string): string =>
  `${prefix}${Date.now().toString(36)}${(seq += 1).toString(36)}`;

/**
 * A new company on the ENTREPRISE edition (every module), free of plan limits, with the
 * position check off unless a chain is about it. The edition is set by the super-admin
 * through the API, as in production.
 */
export async function company(
  label: string,
  opts: { edition?: 'ESSENTIEL' | 'IMPORT' | 'DISTRIBUTION' | 'ENTREPRISE'; geo?: boolean } = {},
): Promise<Company> {
  assertAuditDb();
  const tag = uniq('a2');
  const session = await register(
    `A2 ${label} ${tag}`,
    `Owner ${label}`,
    `${tag}@audit.local`,
    PASSWORD,
    'DISTRIBUTEUR',
  );
  await call(`/admin/tenants/${session.tenantId}/subscription`, {
    method: 'PATCH',
    token: await adminToken(),
    body: { isFree: true, edition: opts.edition ?? 'ENTREPRISE' },
  });
  const owner = new Api(session.token, `owner(${label})`);
  if (!opts.geo) {
    const settings = await owner.read<Record<string, unknown>>('/tenant/settings');
    await patchSettings(owner, settings, { geoCheckMode: 'OFF' });
  }
  const units = await owner.read<{ id: string; code: string }[]>('/units');
  const levels = await owner.read<{ id: string; position: number }[]>('/price-levels');
  const warehouses = await owner.read<{ id: string; type: string }[]>('/warehouses');
  const main = warehouses.find((w) => w.type === 'MAIN');
  assert(!!main, 'the company has no dépôt principal');
  return {
    session,
    tenantId: session.tenantId,
    owner,
    units: Object.fromEntries(units.map((u) => [u.code, u.id])),
    levels: [...levels].sort((a, b) => a.position - b.position).map((l) => l.id),
    mainWarehouseId: main!.id,
  };
}

/** PATCH /tenant/settings wants the whole settings object: what was read, with the change. */
export async function patchSettings(
  owner: Api,
  current: Record<string, unknown>,
  change: Record<string, unknown>,
): Promise<void> {
  const { tenantId: _t, name: _n, updatedAt: _u, ...settings } = current;
  void [_t, _n, _u];
  await owner.patch('/tenant/settings', { ...settings, ...change });
}

export async function setSetting(c: Company, change: Record<string, unknown>): Promise<void> {
  await patchSettings(
    c.owner,
    await c.owner.read<Record<string, unknown>>('/tenant/settings'),
    change,
  );
}

export interface Item {
  id: string;
  unitId: string;
  cartonUnitId: string;
}

/** A pièce product with a carton of 12, priced `priceHt` on every level, TVA 19 %. */
export async function product(
  c: Company,
  opts: {
    priceHt?: string;
    tvaRate?: string;
    designation?: string;
    brandId?: string | null;
    weightKg?: string;
  } = {},
): Promise<Item> {
  const piece = c.units['PIECE']!;
  const carton = c.units['CARTON']!;
  const p = await c.owner.post<{ id: string }>(
    '/products',
    {
      reference: uniq('P-'),
      designation: opts.designation ?? `Article ${uniq('')}`,
      baseUnitId: piece,
      tvaRate: opts.tvaRate ?? '19',
      minStock: '0',
      ...(opts.brandId !== undefined ? { brandId: opts.brandId } : {}),
      ...(opts.weightKg ? { weightKg: opts.weightKg } : {}),
      units: [
        {
          unitId: piece,
          factorToBase: '1',
          barcode: null,
          isDefaultSale: true,
          isDefaultPurchase: true,
        },
        {
          unitId: carton,
          factorToBase: '12',
          barcode: null,
          isDefaultSale: false,
          isDefaultPurchase: false,
        },
      ],
      prices: c.levels.slice(0, 3).map((priceLevelId) => ({
        unitId: piece,
        priceLevelId,
        priceHt: opts.priceHt ?? '1000',
      })),
    },
    null,
  );
  return { id: p.id, unitId: piece, cartonUnitId: carton };
}

export async function client(
  c: Company,
  name = 'Client',
  extra: Record<string, unknown> = {},
): Promise<string> {
  const res = await c.owner.post<{ id: string }>(
    '/clients',
    { code: uniq('C-'), name: `${name} ${uniq('')}`, type: 'PARTICULIER', ...extra },
    null,
  );
  return res.id;
}

export async function supplier(
  c: Company,
  name = 'Fournisseur',
  currency = 'DZD',
): Promise<string> {
  return (
    await c.owner.post<{ id: string }>(
      '/suppliers',
      { name: `${name} ${uniq('')}`, currency },
      null,
    )
  ).id;
}

export async function openingStock(
  c: Company,
  item: Item,
  qty: string,
  unitCost: string,
  warehouseId?: string,
): Promise<void> {
  await c.owner.post('/stock/opening', {
    ...(warehouseId ? { warehouseId } : {}),
    note: 'audit 02 opening',
    lines: [{ productId: item.id, unitId: item.unitId, qty, unitCost }],
  });
}

export interface Staff {
  id: string;
  email: string;
  role: string;
  api: Api;
}

/** A user who can log in: invited by link, the invitation accepted with the audit password. */
export async function invite(
  c: Company,
  role: string,
  managerId: string | null = null,
): Promise<Staff> {
  const email = `${uniq('u')}@audit.local`;
  const inv = await c.owner.post<{ inviteUrl: string }>(
    '/users/invite',
    { fullName: `A2 ${role} ${uniq('')}`, email, role, managerId, mode: 'LINK' },
    null,
  );
  const inviteToken = inv.inviteUrl.split('/').pop()!;
  const res = await call<{ accessToken: string; user: { id: string } }>(
    `/auth/invitations/${inviteToken}/accept`,
    { method: 'POST', body: { password: PASSWORD }, headers: { 'X-Client-Type': 'native' } },
  );
  return {
    id: res.body.user.id,
    email,
    role,
    api: new Api(res.body.accessToken, role.toLowerCase()),
  };
}

// ---------------------------------------------------------------- what the database holds

const one = async (sql: string, params: unknown[]): Promise<string | null> => {
  const rows = await query<{ v: string | null }>(sql, params);
  return rows[0]?.v ?? null;
};

export const dbRead = {
  /** Product level, company-wide. */
  stock: (tenantId: string, productId: string) =>
    one(
      `SELECT "qtyBase"::text AS v FROM product_stocks WHERE "tenantId" = $1::uuid AND "productId" = $2::uuid`,
      [tenantId, productId],
    ),
  avgCost: (tenantId: string, productId: string) =>
    one(
      `SELECT "avgCost"::text AS v FROM product_stocks WHERE "tenantId" = $1::uuid AND "productId" = $2::uuid`,
      [tenantId, productId],
    ),
  warehouseStock: async (tenantId: string, productId: string, warehouseId: string) =>
    (await one(
      `SELECT "qtyBase"::text AS v FROM warehouse_stocks WHERE "tenantId" = $1::uuid AND "productId" = $2::uuid AND "warehouseId" = $3::uuid`,
      [tenantId, productId, warehouseId],
    )) ?? '0',
  clientBalance: async (tenantId: string, clientId: string) =>
    (await one(
      `SELECT balance::text AS v FROM client_balances WHERE "tenantId" = $1::uuid AND "clientId" = $2::uuid`,
      [tenantId, clientId],
    )) ?? '0',
  clientLedger: async (tenantId: string, clientId: string) =>
    (await one(
      `SELECT COALESCE(SUM(amount), 0)::text AS v FROM client_ledger_entries WHERE "tenantId" = $1::uuid AND "clientId" = $2::uuid`,
      [tenantId, clientId],
    ))!,
  supplierBalance: async (tenantId: string, supplierId: string) =>
    (await one(
      `SELECT balance::text AS v FROM supplier_balances WHERE "tenantId" = $1::uuid AND "supplierId" = $2::uuid`,
      [tenantId, supplierId],
    )) ?? '0',
  supplierLedger: async (tenantId: string, supplierId: string) =>
    (await one(
      `SELECT COALESCE(SUM(amount), 0)::text AS v FROM supplier_ledger_entries WHERE "tenantId" = $1::uuid AND "supplierId" = $2::uuid`,
      [tenantId, supplierId],
    ))!,
  cashBalance: async (tenantId: string, accountId: string) =>
    (await one(
      `SELECT balance::text AS v FROM cash_account_balances WHERE "tenantId" = $1::uuid AND "cashAccountId" = $2::uuid`,
      [tenantId, accountId],
    )) ?? '0',
  cashLedger: async (tenantId: string, accountId: string) =>
    (await one(
      `SELECT COALESCE(SUM(amount), 0)::text AS v FROM cash_movements WHERE "tenantId" = $1::uuid AND "cashAccountId" = $2::uuid`,
      [tenantId, accountId],
    ))!,
};

export interface CashAccount {
  id: string;
  name: string;
  type: 'CAISSE' | 'BANQUE' | 'CCP';
  isDefault: boolean;
  warehouseId: string | null;
}

/** The accounts of the company (the first read seeds Caisse principale and Banque principale). */
export async function cashAccounts(c: Company): Promise<CashAccount[]> {
  const body = await c.owner.read<CashAccount[] | { items: CashAccount[] }>('/cash-accounts');
  return Array.isArray(body) ? body : body.items;
}

/** Document numbers issued to a tenant for a prefix must be exactly 1..N. */
export async function assertContiguous(
  tenantId: string,
  table: string,
  prefix: string,
): Promise<void> {
  const rows = await query<{ number: string }>(
    `SELECT "number" FROM ${table} WHERE "tenantId" = $1::uuid AND "number" LIKE $2 ORDER BY "number"`,
    [tenantId, `${prefix}-%`],
  );
  const nums = rows.map((r) => Number(r.number.split('-')[2]));
  nums.forEach((n, i) =>
    assert(
      n === i + 1,
      `${prefix} numbers of the tenant are not 1..N: ${rows.map((r) => r.number).join(', ')}`,
    ),
  );
}
