/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- API payloads are read loosely on purpose */
import type { Api, Obj } from './http.js';
import type { Point } from './gps.js';

/** Today in Algiers (UTC+1, no DST). */
export const algiersToday = (): string => new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Money as integer cents: never a float on an amount. */
export function toCents(s: string): bigint {
  const [i = '0', f = ''] = s.split('.');
  return BigInt(i) * 100n + BigInt((f + '00').slice(0, 2));
}
export function fromCents(c: bigint): string {
  const neg = c < 0n;
  const a = neg ? -c : c;
  return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
}
/** HT * 1.25 rounded up to the next 100 DA: always above the TTC (the surplus comes back as change). */
export function overTtc(htCents: bigint): string {
  const c = (htCents * 125n) / 100n;
  return fromCents(((c + 9999n) / 10000n) * 10000n);
}
export function share(htCents: bigint, pct: bigint): string {
  return fromCents((htCents * pct) / 100n / 100n * 100n);
}

export interface Sellable {
  id: string;
  ref: string;
  designation: string;
  /** Default sale unit. */
  unitId: string;
  factorToBase: number;
  baseUnitId: string;
  /** Price HT of one sale unit, "1234.00". */
  priceHt: string;
}

export interface ClientPlan {
  idx: number;
  code: string;
  sellerKey: string;
  town: string;
  point: Point | null;
  debt: string | null;
  creditLimit: string | null;
}

export interface ClientRec extends ClientPlan {
  id: string;
  hasPoint: boolean;
  balance: number;
}

export interface UserRec {
  key: string;
  id: string;
  api: Api;
}

export interface Ctx {
  owner: Api;
  base: string;
  today: string;
  onlyToday: boolean;
  usersPassword: string;
  mainId: string;
  users: Record<string, UserRec>;
  trucks: Record<string, string>;
  clients: ClientRec[];
  sellable: Sellable[];
  levelIds: string[];
  routes: Record<string, { id: string; clients: ClientRec[] }>;
  warnings: string[];
}

/** A non-fatal step: log the failure, count it, go on (the next run completes it). */
export async function soft<T>(ctx: Ctx, label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    const msg = `${label}: ${(err as Error).message}`;
    ctx.warnings.push(msg);
    console.warn(`  ! ${msg}`);
    return undefined;
  }
}

export const arr = <T = Obj>(x: any): T[] => (Array.isArray(x) ? x : (x?.items ?? []));

export const isoNow = (offsetMin = 0): string => new Date(Date.now() + offsetMin * 60_000).toISOString();

export function geoAt(p: Point, accuracyM = 10, note?: string): Obj {
  return { lat: p.lat, lng: p.lng, accuracyM, capturedAt: isoNow(), isMocked: false, ...(note ? { note } : {}) };
}
