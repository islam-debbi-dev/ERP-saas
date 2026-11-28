/**
 * Audit 02, part B.2: permissions inside a tenant.
 *
 * 1. Matrix. For each role, every route whose @Roles / @RequirePermission the role does not
 *    satisfy (read from the controllers and from ROLE_PERMISSIONS of @erp/shared) must
 *    answer 403. Guards run before validation, so an empty body is enough.
 * 2. What a role is shown. The companies of the recording get one user of each role; every
 *    GET the owner can read is read again by each role, and the answers are searched for
 *    cost, margin and salary figures the role has no permission to see.
 *
 *   tsx api/security/record.ts && tsx api/security/permissions.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { area, assert, check, record, writeSummary } from '../../lib/harness.ts';
import { call, idemKey, login, request, type Recorded } from '../../lib/http.ts';
import { Api, assertAuditDb, company, invite, OUT, PASSWORD, uniq, type Company } from '../../lib/audit.ts';
import { closeDb, query } from '../../lib/db.ts';
import { readRoutes, type Route } from '../../audit-02/routes.ts';
import { ROLE_PERMISSIONS } from '../../../packages/shared/src/permissions.ts';
import { FIELD_SELLER_ROLES, TEAM_LEAD_ROLES } from '../../../packages/shared/src/enums.ts';

assertAuditDb();
const ROLES = ['MANAGER', 'SELLER', 'STOREKEEPER', 'SUPERVISOR', 'LIVREUR', 'AREA_MANAGER', 'PREVENDEUR'] as const;
/** Role lists the controllers take from @erp/shared. */
const SHARED_LISTS: Record<string, readonly string[]> = { FIELD_SELLER_ROLES, TEAM_LEAD_ROLES };
type RoleName = (typeof ROLES)[number];
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

const routes = readRoutes().filter(
  (r) => !r.path.startsWith('/admin') && !r.decorators.concat(r.classDecorators).some((d) => /^@(Public|AdminPublic)\(/.test(d)),
);
/** `@Roles(...MANAGERS, Role.SUPERVISOR)`: the role lists are constants of the controller (or imported). */
const SRC = fileURLToPath(new URL('../../../apps/api/src/', import.meta.url));
const constCache = new Map<string, Map<string, string>>();
function constants(file: string): Map<string, string> {
  if (!constCache.has(file)) {
    const src = readFileSync(file, 'utf8');
    const m = new Map<string, string>();
    for (const x of src.matchAll(/const ([A-Z_]+)(?::[^=]+)? = \[([^\]]*)\]/g)) m.set(x[1]!, x[2]!);
    // Imported constants: look in the imported relative files.
    for (const imp of src.matchAll(/import \{([^}]+)\} from '(\.[^']+)'/g)) {
      const target = fileURLToPath(new URL(`${imp[2]}.ts`, `file://${file}`));
      let other: Map<string, string>;
      try {
        other = constants(target);
      } catch {
        continue;
      }
      for (const name of imp[1]!.split(',').map((n) => n.trim())) if (other.has(name) && !m.has(name)) m.set(name, other.get(name)!);
    }
    constCache.set(file, m);
  }
  return constCache.get(file)!;
}
function rolesOf(expr: string, file: string): string[] {
  const out: string[] = [];
  for (const part of expr.split(',').map((x) => x.trim()).filter(Boolean)) {
    const direct = /^Role\.([A-Z_]+)$/.exec(part);
    const spread = /^\.\.\.([A-Z_]+)$/.exec(part);
    if (direct) out.push(direct[1]!);
    else if (spread && SHARED_LISTS[spread[1]!]) out.push(...SHARED_LISTS[spread[1]!]!);
    else if (spread) {
      const def = constants(file).get(spread[1]!);
      if (def === undefined) throw new Error(`cannot resolve ${part} in ${file}`);
      out.push(...rolesOf(def, file));
    } else throw new Error(`cannot read role list "${expr}" in ${file}`);
  }
  return out;
}
/** Handler decorators win over class decorators (Reflector.getAllAndOverride). */
function need(r: Route): { roles: string[] | null; permission: string | null } {
  const pick = (re: RegExp): string | null =>
    r.decorators.find((d) => re.test(d)) ?? r.classDecorators.find((d) => re.test(d)) ?? null;
  const roles = pick(/^@Roles\(/);
  const perm = pick(/^@RequirePermission\(/);
  return {
    roles: roles ? rolesOf(roles.slice('@Roles('.length, -1), fileURLToPath(new URL(`../../../${r.file}`, import.meta.url))) : null,
    permission: perm ? /Permission\.([A-Z_]+)/.exec(perm)![1]! : null,
  };
}
const fill = (path: string): string =>
  path
    .replace(/:(id|productId|purchaseId|costId|ruleId)\b/g, () => randomUUID())
    .replace(':type', 'BL')
    .replace(':name', 'sales')
    .replace(':code', 'x')
    .replace(':token', 'x');

const dates = (() => {
  const to = new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
  const from = new Date(Date.now() - 80 * 86400_000).toISOString().slice(0, 10);
  return `from=${from}&to=${to}`;
})();

// ------------------------------------------------------------------ 1. matrix
area('B2. Permissions: every route a role must not reach answers 403');
const c: Company = await company('Roles');
const staff = Object.fromEntries(
  await Promise.all(ROLES.map(async (role) => [role, await invite(c, role)] as const)),
) as Record<RoleName, Awaited<ReturnType<typeof invite>>>;

interface Cell {
  role: string;
  route: string;
  why: string;
  status: number;
  code: string;
}
const cells: Cell[] = [];
for (const role of ROLES) {
  const perms = new Set<string>(ROLE_PERMISSIONS[role]);
  for (const r of routes) {
    const n = need(r);
    const roleBlocked = n.roles !== null && !n.roles.includes(role);
    const permBlocked = n.permission !== null && !perms.has(n.permission);
    if (!roleBlocked && !permBlocked) continue;
    const res = await request(fill(r.path), {
      method: r.verb,
      token: staff[role].api.token,
      ...(r.verb === 'GET' || r.verb === 'DELETE' ? {} : { body: {} }),
      ...(r.verb === 'GET' ? {} : { idempotencyKey: idemKey('perm') }),
      raw: true,
    });
    cells.push({
      role,
      route: `${r.verb} ${r.path}`,
      why: [roleBlocked ? `@Roles(${n.roles!.join(',')})` : '', permBlocked ? n.permission! : ''].filter(Boolean).join(' + '),
      status: res.status,
      code: /"code":"([A-Z_0-9]+)"/.exec(res.raw)?.[1] ?? '',
    });
  }
}
for (const role of ROLES) {
  const mine = cells.filter((x) => x.role === role);
  await check(`${role}: ${mine.length} forbidden routes all answer 403`, () => {
    const bad = mine.filter((x) => x.status !== 403);
    assert(bad.length === 0, `${bad.length} not 403: ${bad.slice(0, 15).map((x) => `${x.route} (${x.why}) → ${x.status} ${x.code}`).join(' ; ')}`);
  });
}
const open = routes.filter((r) => {
  const n = need(r);
  return n.roles === null && n.permission === null;
});
record({
  name: `routes with neither @Roles nor @RequirePermission (${open.length}): ${open.map((r) => `${r.verb} ${r.path}`).join(', ')}`,
  status: 'INFO',
});

// The same rule holds for a permission taken away from one user (revokes), route by route.
await check('a permission revoked from one user closes its routes at once (CLIENTS_VIEW, SALES_VIEW)', async () => {
  const victim = staff.SELLER;
  await c.owner.put(`/users/${victim.id}/permissions`, { grants: [], revokes: ['CLIENTS_VIEW', 'SALES_VIEW'] });
  const a = await victim.api.get('/clients');
  const b = await victim.api.get('/sales');
  await c.owner.put(`/users/${victim.id}/permissions`, { grants: [], revokes: [] });
  assert(a.status === 403 && b.status === 403, `clients ${a.status}, sales ${b.status}`);
});
await check('a MANAGER cannot grant a permission he does not hold, nor edit the owner', async () => {
  const mgr = staff.MANAGER.api;
  const g = await mgr.send('PUT', `/users/${staff.SELLER.id}/permissions`, { grants: ['SALARY_VIEW'], revokes: [] }, null);
  const o = await mgr.send('PUT', `/users/${c.session.userId}`, { fullName: 'Pwned', email: c.session.email, role: 'SELLER', managerId: null }, null);
  assert(g.status === 403, `grant by a manager: HTTP ${g.status} ${g.raw.slice(0, 120)}`);
  assert(o.status === 403, `owner edited by a manager: HTTP ${o.status} ${o.raw.slice(0, 120)}`);
});
await check('a user granted USERS_MANAGE cannot give himself or another more than he has', async () => {
  await c.owner.put(`/users/${staff.SUPERVISOR.id}/permissions`, { grants: ['USERS_MANAGE', 'USERS_VIEW'], revokes: [] });
  const sup = staff.SUPERVISOR.api;
  const self = await sup.send('PUT', `/users/${staff.SUPERVISOR.id}/permissions`, { grants: ['USERS_MANAGE', 'USERS_VIEW', 'SALARY_VIEW', 'TREASURY_MANAGE'], revokes: [] }, null);
  const other = await sup.send('PUT', `/users/${staff.LIVREUR.id}/permissions`, { grants: ['PAYROLL_PAY'], revokes: [] }, null);
  const promote = await sup.send('PUT', `/users/${staff.LIVREUR.id}`, { fullName: 'Promu', email: staff.LIVREUR.email, role: 'OWNER', managerId: null }, null);
  const inviteOwner = await sup.send('POST', '/users/invite', { fullName: 'Second owner', email: `${uniq('o')}@audit.local`, role: 'OWNER', managerId: null, mode: 'LINK' }, null);
  const inviteManager = await sup.send('POST', '/users/invite', { fullName: 'A manager', email: `${uniq('m')}@audit.local`, role: 'MANAGER', managerId: null, mode: 'LINK' }, null);
  const [me] = await query<{ grants: string[] }>(`SELECT "permissionGrants" AS grants FROM users WHERE id = $1::uuid`, [staff.SUPERVISOR.id]).catch(() => [{ grants: ['?'] }]);
  await c.owner.put(`/users/${staff.SUPERVISOR.id}/permissions`, { grants: [], revokes: [] });
  const got = `self ${self.status}, other ${other.status}, promote to OWNER ${promote.status}, invite OWNER ${inviteOwner.status}, grants now ${JSON.stringify(me?.grants)}`;
  void inviteManager;
  assert(self.status >= 400 && other.status >= 400 && promote.status >= 400 && inviteOwner.status >= 400, got);
});
// docs: USERS_MANAGE = "invite, edit, deactivate users and change their permissions (never above his own)".
await check('a SUPERVISOR granted USERS_MANAGE cannot create or take over an account with more rights than his own', async () => {
  await c.owner.put(`/users/${staff.SUPERVISOR.id}/permissions`, { grants: ['USERS_MANAGE', 'USERS_VIEW'], revokes: [] });
  const sup = staff.SUPERVISOR.api;
  const before = await sup.get(`/reports/margin?${dates}`);
  const facts: string[] = [`the supervisor reads /reports/margin: ${before.status}`];
  // (a) a new MANAGER whose password he chooses
  const email = `${uniq('esc')}@audit.local`;
  const inv = await sup.send('POST', '/users/invite', { fullName: 'Faux gérant', email, role: 'MANAGER', managerId: null, mode: 'PASSWORD', password: 'Temp1234!' }, null);
  facts.push(`invite a MANAGER with a password he chose: ${inv.status}`);
  let asManager = 0;
  if (inv.status < 300) {
    const first = await login(email, 'Temp1234!');
    await call('/auth/password', { method: 'POST', token: first.token, body: { currentPassword: 'Temp1234!', newPassword: PASSWORD } });
    const m = await login(email, PASSWORD);
    asManager = (await request(`/reports/margin?${dates}`, { token: m.token })).status;
    facts.push(`logged in as that manager, /reports/margin: ${asManager}`);
  }
  // (b) an existing LIVREUR promoted to MANAGER
  const promote = await sup.send('PUT', `/users/${staff.LIVREUR.id}`, { fullName: 'Promu', email: staff.LIVREUR.email, role: 'MANAGER', managerId: null }, null);
  facts.push(`promote a LIVREUR to MANAGER: ${promote.status}`);
  if (promote.status < 300) await c.owner.put(`/users/${staff.LIVREUR.id}`, { fullName: 'Livreur', email: staff.LIVREUR.email, role: 'LIVREUR', managerId: null });
  // (c) the password of the real manager (who holds SALARY_VIEW by a grant of the owner)
  await c.owner.put(`/users/${staff.MANAGER.id}/permissions`, { grants: ['SALARY_VIEW'], revokes: [] });
  const reset = await sup.send('POST', `/users/${staff.MANAGER.id}/reset-password`, { mode: 'PASSWORD', password: 'Stolen1234!' }, null);
  facts.push(`reset the password of the manager who holds SALARY_VIEW: ${reset.status}`);
  let stolen = 0;
  if (reset.status < 300) {
    const first = await login(staff.MANAGER.email, 'Stolen1234!');
    await call('/auth/password', { method: 'POST', token: first.token, body: { currentPassword: 'Stolen1234!', newPassword: 'Stolen12345!' } });
    const m = await login(staff.MANAGER.email, 'Stolen12345!');
    stolen = (await request('/employees', { token: m.token })).status;
    facts.push(`logged in as him, /employees (salaries): ${stolen}`);
    staff.MANAGER.api = new Api(m.token, 'manager');
  }
  await c.owner.put(`/users/${staff.SUPERVISOR.id}/permissions`, { grants: [], revokes: [] });
  await c.owner.put(`/users/${staff.MANAGER.id}/permissions`, { grants: [], revokes: [] });
  assert(inv.status >= 400 && promote.status >= 400 && reset.status >= 400, facts.join('; '));
});

// ------------------------------------------------------------------ 2. what each role is shown
area('B2. Permissions: cost, margin and salary figures in what a role can read');
const RECORDING = fileURLToPath(new URL('../../.auth/audit02-recording.json', import.meta.url));
const world = (JSON.parse(readFileSync(RECORDING, 'utf8')) as Record<string, Recorded[]>[])[1]!;
const tid = (token: string): string => (JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as { tid: string; role: string }).tid;
const roleOf = (token: string): string => (JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as { role: string }).role;

const COST = /^(avgCost|cump|unitCost|cost|costBase|landedCost|landedUnitCost|purchasePrice|lastPurchasePrice|lastCost|stockValue|totalValue|totalCost|costTotal|cogs|margin|marginPct|marginRate|grossMargin|netResult|resultatNet|profit|valueAtCost|costPrice|prixRevient|coutRevient|costHt|lineCost|marge)$/i;
const PAY = /^(salary|baseSalary|salaire|netPay|netAPayer|netToPay|grossPay|brut|irg|cnas|cotisation|advanceBalance|totalNet|totalGross|taxable|imposable|paySlip|salaryAmount)$/i;
/** Keys of a JSON answer that match and hold a figure other than null / 0 / "0.00" / []. */
function sensitive(v: unknown, re: RegExp, path = '', out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.slice(0, 50).forEach((x) => sensitive(x, re, `${path}[]`, out));
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      const p = path ? `${path}.${k}` : k;
      const empty = x === null || x === undefined || x === 0 || x === '' || (typeof x === 'string' && /^-?0+(\.0+)?$/.test(x)) || (Array.isArray(x) && x.length === 0);
      if (re.test(k) && !empty && typeof x !== 'object') out.add(p);
      sensitive(x, re, p, out);
    }
  return out;
}

const getRoutes = routes.filter((r) => r.verb === 'GET' && !/\.(xlsx|pdf)$|\/pdf$/.test(r.path));
interface Seen {
  company: string;
  role: string;
  route: string;
  kind: 'cost' | 'pay';
  keys: string[];
  path: string;
}
const seen: Seen[] = [];
/** Every key holding a figure, per role: read by a human to catch a cost under an unexpected name. */
const keyInventory: Record<string, Set<string>> = {};
function inventory(role: string, route: string, v: unknown, path = ''): void {
  if (Array.isArray(v)) v.slice(0, 5).forEach((x) => inventory(role, route, x, path));
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === 'string' && /^-?\d+\.\d{2,3}$/.test(x) && !/^0\.0+$/.test(x)) (keyInventory[role] ??= new Set()).add(`${route} ${path}${k}`);
      inventory(role, route, x, `${path}${k}.`);
    }
}
let read = 0;
const paramDates = (() => {
  const to = new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
  const from = new Date(Date.now() - 80 * 86400_000).toISOString().slice(0, 10);
  return `from=${from}&to=${to}`;
})();
for (const [chain, list] of Object.entries(world)) {
  const ownerToken = list.find((r) => r.token && !r.path.startsWith('/admin') && roleOf(r.token) === 'OWNER')?.token;
  if (!ownerToken) continue;
  const tenantId = tid(ownerToken);
  const owner = new Api(ownerToken, `owner(${chain})`);
  // One user of each role in this company, with the default permissions of the role.
  const users: Record<string, Api> = {};
  for (const role of ROLES) {
    const email = `${uniq('r')}@audit.local`;
    const inv = await owner.post<{ inviteUrl: string }>('/users/invite', { fullName: `B2 ${role}`, email, role, managerId: null, mode: 'LINK' }, null);
    const res = await call<{ accessToken: string }>(`/auth/invitations/${inv.inviteUrl.split('/').pop()!}/accept`, { method: 'POST', body: { password: PASSWORD }, headers: { 'X-Client-Type': 'native' } });
    users[role] = new Api(res.body.accessToken, role);
  }
  // Every id of this company, by table.
  const ids: string[] = [];
  const tables = await query<{ t: string }>(
    `SELECT c.table_name AS t FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.column_name = 'tenantId'
        AND EXISTS (SELECT 1 FROM information_schema.columns i WHERE i.table_schema = 'public' AND i.table_name = c.table_name AND i.column_name = 'id' AND i.data_type = 'uuid')`,
  );
  for (const { t } of tables) {
    const rows = await query<{ id: string }>(`SELECT id::text FROM "${t}" WHERE "tenantId" = $1::uuid ORDER BY "id" LIMIT 2`, [tenantId]);
    ids.push(...rows.map((r) => r.id));
  }
  // The paths the owner can read: every GET route, its id filled with each row of the company.
  const paths = new Set<string>();
  for (const r of getRoutes) {
    const q = /reports|statement|tournees\/reports|geo-checks\/report|attendance\/month|payments\/summary|charges/.test(r.path) ? `?${paramDates}` : '';
    if (!r.path.includes(':')) {
      paths.add(`${r.path}${q}`);
      if (r.path === '/reports/:name') continue;
    } else if (r.path === '/reports/:name') {
      for (const name of ['sales', 'margin', 'stock-movements', 'payments', 'purchases']) paths.add(`/reports/${name}${q}`);
    } else if (/:(id|productId)\b/.test(r.path) && !/:(type|token|code|purchaseId|costId|ruleId)/.test(r.path)) {
      for (const id of ids) {
        const path = r.path.replace(/:(id|productId)\b/, id) + q;
        if ((await owner.get(path)).status === 200) paths.add(path);
      }
    }
  }
  // Recorded GETs too (they carry real query strings).
  for (const r of list) if (r.method === 'GET' && r.status === 200 && r.token === ownerToken && !/pdf|xlsx/.test(r.path)) paths.add(r.path);

  for (const path of paths) {
    const route = `GET ${path.replace(/\?.*/, '').replace(UUID, ':id')}`;
    for (const role of ROLES) {
      const res = await users[role]!.get(path);
      read += 1;
      if (res.status !== 200 || typeof res.body !== 'object') continue;
      inventory(role, route, res.body);
      const perms = new Set<string>(ROLE_PERMISSIONS[role as RoleName]);
      if (!perms.has('VIEW_COST_AND_MARGIN')) {
        const keys = [...sensitive(res.body, COST)];
        if (keys.length) seen.push({ company: chain, role, route, kind: 'cost', keys, path });
      }
      if (!perms.has('SALARY_VIEW')) {
        const keys = [...sensitive(res.body, PAY)];
        if (keys.length) seen.push({ company: chain, role, route, kind: 'pay', keys, path });
      }
    }
  }
}
const group = (kind: 'cost' | 'pay'): string[] => {
  const m = new Map<string, Set<string>>();
  for (const s of seen.filter((x) => x.kind === kind)) {
    const k = `${s.route} → ${s.keys.map((x) => x.replace(/\[\]/g, '')).join(', ')}`;
    m.set(k, (m.get(k) ?? new Set()).add(s.role));
  }
  return [...m].map(([k, roles]) => `${k} [${[...roles].join(', ')}]`).sort();
};
record({ name: `${read} answers read as a non-owner role in ${Object.keys(world).length} companies`, status: 'INFO' });
await check('no cost or margin figure is shown to a role without VIEW_COST_AND_MARGIN', () => {
  const g = group('cost');
  assert(g.length === 0, `${g.length} route(s): ${g.join(' ; ')}`);
});
// SUPPLIERS_ACCOUNT = "supplier balances, ledgers, statements and règlements list".
await check('no supplier balance is shown to a role without SUPPLIERS_ACCOUNT', () => {
  const shown: string[] = [];
  for (const role of ROLES) {
    if (new Set<string>(ROLE_PERMISSIONS[role]).has('SUPPLIERS_ACCOUNT')) continue;
    const keys = [...(keyInventory[role] ?? [])].filter((k) => /^GET \/suppliers\b.* (items\.)?balance(Currency)?$/.test(k));
    if (keys.length) shown.push(`${role}: ${keys.join(', ')}`);
  }
  assert(shown.length === 0, shown.join(' ; '));
});
await check('no salary figure is shown to a role without SALARY_VIEW', () => {
  const g = group('pay');
  assert(g.length === 0, `${g.length} route(s): ${g.join(' ; ')}`);
});

writeFileSync(`${OUT}permissions-detail.json`, JSON.stringify({ matrix: cells, open: open.map((r) => `${r.verb} ${r.path}`), shown: seen, figures: Object.fromEntries(Object.entries(keyInventory).map(([k, v]) => [k, [...v].sort()])) }, null, 1));
writeSummary('permissions');
await closeDb();
process.exit(0);
