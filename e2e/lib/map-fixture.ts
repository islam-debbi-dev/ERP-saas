/**
 * Shared pieces of the phase 35 audit (test-35): the fixture written by `api/map-seed.ts`,
 * a seeded PRNG, the owner connection guard and the proof folder.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ARTIFACTS, DB } from './config.ts';
import { call, login, type Session } from './http.ts';

export const PASSWORD = 'Audit1234!';
export const FIXTURE_FILE = fileURLToPath(new URL('../.auth/map-fixture.json', import.meta.url));
export const PROOFS = `${ARTIFACTS}test-35/`;

export interface SeedUser {
  id: string;
  email: string;
  role: string;
  token: string;
}

export interface SeedTenant {
  tenantId: string;
  name: string;
  owner: SeedUser;
}

export interface MapFixture {
  tag: string;
  createdAt: string;
  admin: { email: string; password: string; secret: string };
  /** Distribution, ASSIGNED_ONLY: the tenant every scope check runs in. */
  a: SeedTenant & {
    manager: SeedUser;
    supervisor: SeedUser;
    /** Two sellers under the supervisor. */
    seller1: SeedUser;
    seller2: SeedUser;
    /** A seller who reports to nobody. */
    sellerOut: SeedUser;
    livreur: SeedUser;
    sectors: { alger: string; oran: string; setif: string };
    depots: { main: string; oran: string; setif: string };
    clients: number;
  };
  /** Distribution: clients at the same coordinates as A's. */
  b: SeedTenant & { seller: SeedUser; sectorId: string; clientIds: string[] };
  /** Essentiel: no GEO_CHECK. */
  c: SeedTenant;
  /** Distribution with GEO_CHECK revoked and TOURNEES kept. */
  d: SeedTenant & { seller: SeedUser; routeId: string; clientIds: string[] };
}

export function loadFixture(): MapFixture {
  if (!existsSync(FIXTURE_FILE)) {
    throw new Error(`No map fixture (${FIXTURE_FILE}): run \`pnpm test:map:seed\` first`);
  }
  return JSON.parse(readFileSync(FIXTURE_FILE, 'utf8')) as MapFixture;
}

export function saveFixture(f: MapFixture): void {
  mkdirSync(fileURLToPath(new URL('../.auth/', import.meta.url)), { recursive: true });
  writeFileSync(FIXTURE_FILE, JSON.stringify(f, null, 2));
}

/**
 * The audit writes its own rows as the database owner. It must never do that on the dev
 * database, even less on a remote one: only on a local database made for this audit.
 */
export function assertAuditDb(url: string = DB): void {
  const u = new URL(url);
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (!local || !u.pathname.startsWith('/erp_t35')) {
    throw new Error(
      `Refusing to write to ${u.hostname}${u.pathname}: set DB to a local erp_t35* database`,
    );
  }
}

/** mulberry32: a small deterministic PRNG, so every run draws the same data. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Logs in, waiting out the login limiter (ten attempts a minute per address, successful
 * ones included: finding #3 of REPORT.md).
 */
export async function loginPatient(email: string, password: string = PASSWORD): Promise<Session> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await login(email, password);
    } catch (err) {
      if (attempt >= 3 || !(err instanceof Error) || !err.message.includes('HTTP 429')) throw err;
      console.log('  (login limiter: waiting 61 s)');
      await sleep(61_000);
    }
  }
}

/** A fresh access token for a seeded user (the fixture's one may have expired). */
export async function freshToken(user: SeedUser): Promise<string> {
  const s = await loginPatient(user.email);
  user.token = s.token;
  return s.token;
}

/**
 * A user who can log in: invited by link, then the invitation accepted with the audit
 * password. (An invitation with a password set by the owner forces a password change at
 * first login, and every login counts against the login limiter.)
 */
export async function inviteUser(
  ownerToken: string,
  role: string,
  label: string,
  managerId: string | null = null,
): Promise<SeedUser> {
  const email = `t35-${label}@audit.local`;
  const inv = await call<{ inviteUrl: string }>('/users/invite', {
    method: 'POST',
    token: ownerToken,
    body: { fullName: `T35 ${label}`, email, role, managerId, mode: 'LINK' },
  });
  const inviteToken = inv.body.inviteUrl.split('/').pop()!;
  const res = await call<{ accessToken: string; user: { id: string } }>(
    `/auth/invitations/${inviteToken}/accept`,
    { method: 'POST', body: { password: PASSWORD }, headers: { 'X-Client-Type': 'native' } },
  );
  return { id: res.body.user.id, email, role, token: res.body.accessToken };
}

export function proof(file: string, content: string): string {
  mkdirSync(PROOFS, { recursive: true });
  writeFileSync(`${PROOFS}${file}`, content);
  return `e2e/artifacts/test-35/${file}`;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
