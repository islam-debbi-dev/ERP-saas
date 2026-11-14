/**
 * Audit 02, part B.2 (scopes): what a user may see inside his own company.
 *
 *  - sellerScope ASSIGNED_ONLY (domain.md, phase 14): a SELLER sees only his clients, his
 *    sales and his versements, a SUPERVISOR those of his team; anything else is "not found".
 *  - dépôt access (phase 24): a dépôt outside the user's reach never appears, not even its name.
 *  - SALARY_VIEW (phases 31, 31b, 34): without it pay does not exist.
 *  - VIEW_COST_AND_MARGIN and SALARY_VIEW inside the Excel exports.
 *
 * Method: build the forbidden rows, then let the restricted user read EVERY GET route (the
 * list comes from the controllers) and search the answers for those rows.
 *
 *   tsx api/security/scopes.ts
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { area, assert, check, record, writeSummary } from '../../lib/harness.ts';
import { request, type Recorded } from '../../lib/http.ts';
import { API } from '../../lib/config.ts';
import { addDays, algiersToday, Api, assertAuditDb, cashAccounts, client, company, invite, openingStock, OUT, product, setSetting, uniq, type Staff } from '../../lib/audit.ts';
import { closeDb, query } from '../../lib/db.ts';
import { readRoutes } from '../../audit-02/routes.ts';

assertAuditDb();
const today = algiersToday();
const range = `from=${addDays(today, -60)}&to=${today}`;
const routes = readRoutes().filter((r) => !r.path.startsWith('/admin'));
const getRoutes = routes.filter((r) => r.verb === 'GET' && !/:(token|code)/.test(r.path));
const NEEDS_RANGE = /reports|statement|geo-checks\/report|payments\/summary|charges|schedule/;

/** Every path of the GET routes, the ids filled with each of `ids`. */
function paths(ids: string[]): string[] {
  const out: string[] = [];
  for (const r of getRoutes) {
    const q = NEEDS_RANGE.test(r.path) ? `?${range}` : r.path === '/attendance/month' || r.path === '/attendance/month/export.xlsx' ? `?month=${today.slice(0, 7)}` : '';
    const variants = r.path.includes(':name') ? ['sales', 'margin', 'stock-movements', 'payments', 'purchases'].map((n) => r.path.replace(':name', n)) : [r.path];
    for (const v of variants) {
      if (!/:(id|productId|type)/.test(v)) out.push(v + q);
      else
        for (const id of ids)
          for (const type of v.includes(':type') ? ['BL', 'FAC', 'AV', 'BR', 'TR', 'BC'] : ['']) out.push(v.replace(':type', type).replace(/:(id|productId)\b/g, id) + q);
    }
  }
  return out;
}

interface Hit {
  who: string;
  path: string;
  status: number;
  found: string[];
}
/** Reads every path as `user` and reports the answers that hold one of the `secrets`. */
async function leaks(who: string, user: Api, list: string[], secrets: Record<string, string>): Promise<Hit[]> {
  const hits: Hit[] = [];
  for (const path of list) {
    const res = await request(path, { token: user.token, raw: true });
    if (res.status >= 400) continue;
    const found = Object.entries(secrets).filter(([, v]) => res.raw.includes(v)).map(([k]) => k);
    if (found.length) hits.push({ who, path: path.replace(/\?.*/, ''), status: res.status, found });
  }
  return hits;
}
const tpl = (p: string): string => p.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id');
const show = (hits: Hit[]): string =>
  [...new Set(hits.map((h) => `${tpl(h.path)} → ${h.found.join('+')}`))].slice(0, 25).join(' ; ');
const allHits: Hit[] = [];
/**
 * What domain.md allows on purpose. Everything else found is a leak.
 *  - phase 24: "the client statement shows the whole account; a line of a dépôt the user does
 *    not work in only shows its date, type, number, amount and dépôt", and a client's debt
 *    is shown per dépôt;
 *  - a transfer names the dépôt its goods come from, also for whoever receives them;
 *  - phases 31b and 34: "managers without SALARY_VIEW see the Salaires total in charges, or
 *    the résultat net would not add up", and a cash movement of a salary keeps its amount.
 */
const BY_DESIGN: [RegExp, RegExp, string][] = [
  [/^\/clients\/[^/]+(\/statement)?$/, /^(dépôt principal \(id\)|its number)$/, 'client account across dépôts'],
  [/^\/stock-transfers/, /^dépôt principal \(id\)$/, 'transfer to his own dépôt'],
  [/^\/(reports\/overview|treasury\/summary|reports\/charges)/, /^figure /, 'salary total in charges and cash'],
];
function split(hits: Hit[], extra: [RegExp, RegExp, string][] = []): { leaks: Hit[]; allowed: string[] } {
  const allowed = new Set<string>();
  const out: Hit[] = [];
  for (const h of hits) {
    const rest = h.found.filter((f) => {
      const rule = [...BY_DESIGN, ...extra].find(([p, k]) => p.test(h.path) && k.test(f));
      if (rule) allowed.add(`${tpl(h.path)} (${rule[2]})`);
      return !rule;
    });
    if (rest.length) out.push({ ...h, found: rest });
  }
  return { leaks: out, allowed: [...allowed] };
}

// =================================================================== seller scope
area('B2. Scope: a seller sees only his clients, sales and versements (ASSIGNED_ONLY)');
const c = await company('Scope');
await setSetting(c, { sellerScope: 'ASSIGNED_ONLY' });
const p = await product(c, { priceHt: '1000' });
await openingStock(c, p, '500', '400');
const supervisor = await invite(c, 'SUPERVISOR');
const s1 = await invite(c, 'SELLER', supervisor.id);
const s2 = await invite(c, 'SELLER');
const NAME1 = `Zeta${uniq('')}`;
const NAME2 = `Omega${uniq('')}`;
const c1 = await client(c, NAME1, { assignedSellerId: s1.id });
const c2 = await client(c, NAME2, { assignedSellerId: s2.id });
const sell = async (who: Staff, clientId: string, paid: string): Promise<{ id: string; number: string }> =>
  (
    await who.api.post<{ sale: { id: string; number: string } }>('/sales/quick', {
      type: 'BL',
      clientId,
      documentDate: today,
      paidAmount: paid,
      paymentMode: 'ESPECES',
      lines: [{ productId: p.id, unitId: p.unitId, qty: '3', unitPriceHt: '1000' }],
    })
  ).sale;
const sale1 = await sell(s1, c1, '0');
const sale2 = await sell(s2, c2, '0');
const pay2 = await s2.api.post<{ id: string; number: string }>('/payments', { clientId: c2, amount: '777', mode: 'ESPECES' });
await s1.api.post('/payments', { clientId: c1, amount: '111', mode: 'ESPECES' });
const order2 = await s2.api.post<{ id: string }>('/orders', { clientId: c2, warehouseId: c.mainWarehouseId, lines: [{ productId: p.id, unitId: p.unitId, qty: '2' }] });
const visit2 = await s2.api.send<{ id: string }>('POST', '/visits', { clientId: c2, startedAt: new Date().toISOString(), outcome: 'NO_SALE', reason: 'CLOSED' });

const foreign = { 'client of seller 2': c2, 'client name': NAME2, 'sale of seller 2': sale2.id, 'sale number': sale2.number, 'versement of seller 2': pay2.id, 'versement number': pay2.number, 'order of seller 2': order2.id };
const idList = [c2, sale2.id, pay2.id, order2.id, visit2.body?.id ?? c2, p.id, c1, sale1.id, s2.id];
const sellerHits = await leaks('seller 1', s1.api, paths(idList), foreign);
allHits.push(...sellerHits);
await check("seller 1 finds nothing of seller 2 in any GET route (his client, sale, versement, order)", () => {
  assert(sellerHits.length === 0, `${sellerHits.length} answer(s): ${show(sellerHits)}`);
});
const supHits = await leaks('supervisor of seller 1', supervisor.api, paths(idList), foreign);
allHits.push(...supHits);
await check('the supervisor of seller 1 finds nothing of seller 2 (not in his team)', () => {
  assert(supHits.length === 0, `${supHits.length} answer(s): ${show(supHits)}`);
});
await check('the supervisor does see the sale of his own seller', async () => {
  const res = await supervisor.api.get(`/sales/${sale1.id}`);
  assert(res.status === 200, `HTTP ${res.status}`);
});
const writes: [string, 'POST' | 'PATCH' | 'PUT' | 'DELETE', string, unknown][] = [
  ['sell to the client of seller 2', 'POST', '/sales/quick', { type: 'BL', clientId: c2, documentDate: today, paidAmount: '0', paymentMode: 'ESPECES', lines: [{ productId: p.id, unitId: p.unitId, qty: '1', unitPriceHt: '1000' }] }],
  ['collect a versement from the client of seller 2', 'POST', '/payments', { clientId: c2, amount: '10', mode: 'ESPECES' }],
  ['take an order from the client of seller 2', 'POST', '/orders', { clientId: c2, warehouseId: c.mainWarehouseId, lines: [{ productId: p.id, unitId: p.unitId, qty: '1' }] }],
  ['record a visit to the client of seller 2', 'POST', '/visits', { clientId: c2, startedAt: new Date().toISOString(), outcome: 'NO_SALE', reason: 'CLOSED' }],
  ['return the sale of seller 2', 'POST', `/sales/${sale2.id}/returns`, { disposition: 'RESTOCK', reason: 'x', lines: [] }],
  ['share the relevé of the client of seller 2', 'POST', '/share-links', { docType: 'RELEVE', docId: c2, from: addDays(today, -30), to: today }],
  ['edit the client of seller 2', 'PATCH', `/clients/${c2}`, { code: 'X', name: 'Pwned', type: 'PARTICULIER', version: 1 }],
  ['move the pin of the client of seller 2', 'PATCH', `/clients/${c2}/location`, { lat: 36.7, lng: 3.0, accuracyM: 5 }],
  ['cancel the order of seller 2', 'POST', `/orders/${order2.id}/cancel`, { reason: 'attaque' }],
];
for (const [name, method, path, body] of writes) {
  await check(`seller 1 cannot ${name}`, async () => {
    const res = await s1.api.send(method, path, body, method === 'POST' ? undefined : null);
    assert(res.status === 404 || res.status === 403, `HTTP ${res.status} ${res.raw.slice(0, 200)}`);
  });
}
await check("a seller's report and dashboard figures are his own, whatever he asks for", async () => {
  const mine = await s1.api.get<{ totals?: Record<string, string>; rows?: unknown[] }>(`/reports/sales?${range}`);
  const other = await s1.api.get(`/reports/sales?${range}&sellerId=${s2.id}`);
  const team = await s1.api.get(`/reports/sales?${range}&teamOf=${supervisor.id}`);
  const dash = await s1.api.get('/dashboard');
  // Two sales of 3 570 TTC exist; his own is one of them.
  const sum = (raw: string): string[] => [...raw.matchAll(/"(?:totalTtc|ttc|ca|revenue|salesTtc|turnover)":"([\d.]+)"/g)].map((m) => m[1]!);
  const facts = `own ${mine.status} ${sum(mine.raw).slice(0, 3)}, sellerId=other ${other.status} ${sum(other.raw).slice(0, 3)}, teamOf ${team.status} ${sum(team.raw).slice(0, 3)}, dashboard ${dash.status}`;
  assert(!other.raw.includes('7140') && !mine.raw.includes('7140') && !team.raw.includes('7140') && !dash.raw.includes('7140'), `a figure covers both sellers: ${facts}`);
  assert(other.status >= 400 || !sum(other.raw).some((v) => Number(v) > 0) || other.raw === mine.raw, `sellerId of another seller answered: ${facts} ${other.raw.slice(0, 300)}`);
});

// =================================================================== dépôt reach
area('B2. Scope: a user limited to one dépôt never sees another');
const d = await company('Depot');
const dp = await product(d, { priceHt: '1000' });
const WH2 = `Annexe${uniq('')}`;
const wh2 = await d.owner.post<{ id: string }>('/warehouses', { name: WH2, type: 'SECONDARY', assignedUserId: null }, null);
await openingStock(d, dp, '150', '400');
const fill = await d.owner.post<{ id: string }>('/stock-transfers', { type: 'TRANSFER', fromWarehouseId: d.mainWarehouseId, toWarehouseId: wh2.id, lines: [{ productId: dp.id, unitId: dp.unitId, qty: '50' }] });
await d.owner.post(`/stock-transfers/${fill.id}/validate`, {});
const mainName = (await d.owner.read<{ id: string; name: string }[]>('/warehouses')).find((w) => w.id === d.mainWarehouseId)!.name;
const dcl = await client(d, 'Client dépôt');
const quick = async (who: Api, warehouseId: string): Promise<{ id: string; number: string }> =>
  (await who.post<{ sale: { id: string; number: string } }>('/sales/quick', { type: 'BL', clientId: dcl, warehouseId, documentDate: today, paidAmount: '500', paymentMode: 'ESPECES', lines: [{ productId: dp.id, unitId: dp.unitId, qty: '2', unitPriceHt: '1000' }] })).sale;
const saleMain = await quick(d.owner, d.mainWarehouseId);
const saleWh2 = await quick(d.owner, wh2.id);
const accounts = await cashAccounts(d);
const caisseMain = accounts.find((a) => a.type === 'CAISSE' && a.isDefault)!;
const cats = await d.owner.read<{ items?: { id: string }[] } | { id: string }[]>('/expense-categories');
const catId = (Array.isArray(cats) ? cats : (cats.items ?? []))[0]!.id;
const PAYEE = `Payee${uniq('')}`;
const expMain = await d.owner.post<{ id: string; number: string }>('/expenses', { categoryId: catId, amount: '4321', date: today, mode: 'ESPECES', payee: PAYEE, warehouseId: d.mainWarehouseId });
const invMain = await d.owner.post<{ id: string }>('/inventories', { note: 'inventaire principal', warehouseId: d.mainWarehouseId });
const transfer = await d.owner.post<{ id: string }>('/stock-transfers', { type: 'TRANSFER', fromWarehouseId: d.mainWarehouseId, toWarehouseId: wh2.id, lines: [{ productId: dp.id, unitId: dp.unitId, qty: '5' }] });
const EMP = `Salarie${uniq('')}`;
const emp = await d.owner.post<{ id: string }>('/employees', { fullName: EMP, hireDate: addDays(today, -200), contract: 'CDI', declared: true, warehouseId: d.mainWarehouseId }, null);

const limited = await invite(d, 'MANAGER');
await d.owner.put(`/users/${limited.id}/access`, { access: [{ warehouseId: wh2.id, level: 'OPERATE' }] });
const stats = await invite(d, 'MANAGER');
await d.owner.put(`/users/${stats.id}/access`, { access: [{ warehouseId: wh2.id, level: 'VIEW_STATS' }] });

const depotSecrets = {
  'dépôt principal (id)': d.mainWarehouseId,
  'sale of the dépôt principal': saleMain.id,
  'its number': saleMain.number,
  'caisse principale (id)': caisseMain.id,
  'dépense of the dépôt principal': expMain.id,
  'its payee': PAYEE,
  'inventory of the dépôt principal': invMain.id,
  'employee of the dépôt principal': EMP,
};
const depotIds = [d.mainWarehouseId, saleMain.id, caisseMain.id, expMain.id, invMain.id, transfer.id, emp.id, dp.id, dcl, wh2.id, saleWh2.id];
const limitedAll = await leaks('manager limited to the annexe (OPERATE)', limited.api, paths(depotIds), depotSecrets);
const { leaks: limitedHits, allowed: limitedAllowed } = split(limitedAll);
allHits.push(...limitedHits);
record({ name: `allowed by domain.md and not counted: ${limitedAllowed.join(' ; ')}`, status: 'INFO' });
await check('a MANAGER working only in the annexe finds nothing of the dépôt principal in any GET route', () => {
  assert(limitedHits.length === 0, `${limitedHits.length} answer(s): ${show(limitedHits)}`);
});
await check('he does see the sale of his own dépôt', async () => {
  assert((await limited.api.get(`/sales/${saleWh2.id}`)).status === 200, 'his own sale is hidden');
});
const depotWrites: [string, 'POST' | 'PATCH' | 'PUT', string, unknown][] = [
  ['sell from the dépôt principal', 'POST', '/sales/quick', { type: 'BL', clientId: dcl, warehouseId: d.mainWarehouseId, documentDate: today, paidAmount: '0', paymentMode: 'ESPECES', lines: [{ productId: dp.id, unitId: dp.unitId, qty: '1', unitPriceHt: '1000' }] }],
  ['adjust the stock of the dépôt principal', 'POST', '/stock/adjustments', { reason: 'ERREUR', warehouseId: d.mainWarehouseId, lines: [{ productId: dp.id, unitId: dp.unitId, qty: '-1' }] }],
  ['take stock out of the dépôt principal by transfer', 'POST', '/stock-transfers', { type: 'TRANSFER', fromWarehouseId: d.mainWarehouseId, toWarehouseId: wh2.id, lines: [{ productId: dp.id, unitId: dp.unitId, qty: '5' }] }],
  ['cancel the sale of the dépôt principal', 'POST', `/sales/${saleMain.id}/cancel`, { reason: 'attaque' }],
  ['cancel the dépense of the dépôt principal', 'POST', `/expenses/${expMain.id}/cancel`, { reason: 'attaque' }],
  ['pay a dépense from the caisse principale', 'POST', '/expenses', { categoryId: catId, amount: '50', date: today, mode: 'ESPECES', payee: 'x', warehouseId: wh2.id, cashAccountId: caisseMain.id }],
  ['collect a versement into the caisse principale', 'POST', '/payments', { clientId: dcl, amount: '10', mode: 'ESPECES', cashAccountId: caisseMain.id }],
  ['count the caisse principale', 'POST', `/cash-accounts/${caisseMain.id}/counts`, { counted: '0', reason: 'attaque' }],
  ['give himself access to the dépôt principal', 'PUT', `/users/${limited.id}/access`, { access: [{ warehouseId: d.mainWarehouseId, level: 'OPERATE' }, { warehouseId: wh2.id, level: 'OPERATE' }] }],
];
for (const [name, method, path, body] of depotWrites) {
  await check(`the manager of the annexe cannot ${name}`, async () => {
    const res = await limited.api.send(method, path, body, method === 'POST' ? undefined : null);
    assert(res.status >= 400 && res.status < 500 && res.status !== 400, `HTTP ${res.status} ${res.raw.slice(0, 200)}`);
  });
}
// VIEW_STATS: "its dashboard, reports and sell-out figures, never a single document,
// client ledger detail or user list".
const statsHits = split(
  await leaks('manager with VIEW_STATS on the annexe', stats.api, paths(depotIds), {
    ...depotSecrets,
    'a document of the annexe': saleWh2.id,
    'its number (annexe)': saleWh2.number,
  }),
  [],
).leaks.filter((h) => !/^\/clients\/[^/]+$/.test(h.path));
allHits.push(...statsHits);
await check('a user with "Voir les statistiques" only reads no single document and nothing of the other dépôt', () => {
  assert(statsHits.length === 0, `${statsHits.length} answer(s): ${show(statsHits)}`);
});
await check('"Voir les statistiques" gives no client ledger and no user list', async () => {
  const st = await stats.api.get(`/clients/${dcl}/statement?${range}`);
  const users = await stats.api.get('/users');
  const sale = await stats.api.send('POST', '/sales/quick', { type: 'BL', clientId: dcl, warehouseId: wh2.id, documentDate: today, paidAmount: '0', paymentMode: 'ESPECES', lines: [{ productId: dp.id, unitId: dp.unitId, qty: '1', unitPriceHt: '1000' }] });
  assert(st.status >= 400 && users.status >= 400 && sale.status >= 400, `statement ${st.status}, users ${users.status}, sale from the annexe ${sale.status}`);
});

// =================================================================== pay privacy
area('B2. Scope: without SALARY_VIEW pay does not exist');
const RECORDING = fileURLToPath(new URL('../../.auth/audit02-recording.json', import.meta.url));
const payroll = (JSON.parse(readFileSync(RECORDING, 'utf8')) as Record<string, Recorded[]>[])[1]!['payroll']!;
const ownerTok = payroll.find((r) => r.token && r.path === '/employees')!.token!;
const payOwner = new Api(ownerTok, 'owner(paie)');
const payTenant = (JSON.parse(Buffer.from(ownerTok.split('.')[1]!, 'base64url').toString()) as { tid: string }).tid;
const inv = await payOwner.post<{ inviteUrl: string }>('/users/invite', { fullName: 'Gérant sans paie', email: `${uniq('g')}@audit.local`, role: 'MANAGER', managerId: null, mode: 'LINK' }, null);
const acc = await request<{ accessToken: string }>(`/auth/invitations/${inv.inviteUrl.split('/').pop()!}/accept`, { method: 'POST', body: { password: 'Audit1234!' }, headers: { 'X-Client-Type': 'native' } });
const mgr = new Api(acc.body.accessToken, 'manager(paie)');
const payRows = await query<{ kind: string; id: string; number: string | null }>(
  `SELECT 'avance or salary dépense' AS kind, id::text, "number" FROM expenses WHERE "tenantId" = $1::uuid AND ("employeeId" IS NOT NULL OR "payrollRunId" IS NOT NULL)
   UNION ALL SELECT 'payroll run', id::text, "number" FROM payroll_runs WHERE "tenantId" = $1::uuid
   UNION ALL SELECT 'payslip', id::text, NULL FROM payslips WHERE "tenantId" = $1::uuid
   UNION ALL SELECT 'employee ledger entry', id::text, NULL FROM employee_ledger_entries WHERE "tenantId" = $1::uuid`,
  [payTenant],
);
const paySecrets: Record<string, string> = {};
payRows.forEach((r, i) => {
  paySecrets[`${r.kind} #${i} (id)`] = r.id;
  if (r.number) paySecrets[`${r.kind} ${r.number}`] = r.number;
});
// The figures of the chain: base 60 000, brut 58 000, net 46 230, net à payer 41 230, IRG 6 550.
for (const v of ['60000.00', '58000.00', '46230.00', '41230.00', '6550.00']) paySecrets[`figure ${v}`] = `"${v}"`;
const empIds = (await query<{ id: string }>(`SELECT id::text FROM employees WHERE "tenantId" = $1::uuid`, [payTenant])).map((r) => r.id);
const payIds = [...payRows.map((r) => r.id), ...empIds, ...(await query<{ id: string }>(`SELECT id::text FROM cash_accounts WHERE "tenantId" = $1::uuid`, [payTenant])).map((r) => r.id)];
const paySplit = split(await leaks('manager without SALARY_VIEW', mgr, paths(payIds), paySecrets));
const payHits = paySplit.leaks;
allHits.push(...payHits);
record({ name: `allowed by domain.md and not counted: ${paySplit.allowed.join(' ; ')}`, status: 'INFO' });
record({ name: `${payRows.length} pay rows of the company searched in ${paths(payIds).length} GET paths`, status: 'INFO' });
await check('a MANAGER without SALARY_VIEW finds no pay row and no pay figure in any GET route', () => {
  assert(payHits.length === 0, `${payHits.length} answer(s): ${show(payHits)}`);
});

// =================================================================== exports
area('B2. Scope: Excel exports');
const dir = mkdtempSync(`${tmpdir()}/audit02-xlsx-`);
/** The text of every cell of a workbook (shared strings and inline strings). */
async function xlsxText(token: string, path: string): Promise<{ status: number; text: string; values?: string[] }> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const buf = Buffer.from(await res.arrayBuffer());
  if (res.status !== 200) return { status: res.status, text: buf.toString('utf8').slice(0, 200) };
  const file = `${dir}/${uniq('x')}.xlsx`;
  writeFileSync(file, buf);
  const xml = execFileSync('unzip', ['-p', file, 'xl/sharedStrings.xml', 'xl/worksheets/*.xml'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return {
    status: 200,
    text: [...xml.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => m[1]).join(' | '),
    values: [...xml.matchAll(/<v>([^<]*)<\/v>/g)].map((m) => m[1]!),
  };
}
// The seller of the import company sold goods with a known margin; give one EXPORT_DATA only.
const exporter = await invite(c, 'MANAGER');
await c.owner.put(`/users/${exporter.id}/permissions`, { grants: [], revokes: ['VIEW_COST_AND_MARGIN'] });
const exportRoutes = routes.filter((r) => r.verb === 'GET' && r.path.endsWith('.xlsx') && !r.path.includes(':id'));
// What the owner sees and this user must not: the margin and the stock value of the company.
const ov = await c.owner.read<{ total: { margin: string | null; stock: { value: string | null } } }>(`/reports/overview?${range}`);
const secretFigures = [ov.total.margin, ov.total.stock.value].filter((v): v is string => !!v && Number(v) !== 0).map((v) => String(Number(v)));
record({ name: `figures searched in the exports: margin ${ov.total.margin}, stock value ${ov.total.stock.value}`, status: 'INFO' });
const COSTWORD = /co[uû]t|cost|marge|margin|cump|pmp|prix d.achat|revient|valeur du stock|stock value|b[ée]n[ée]fice|r[ée]sultat net|تكلفة|هامش/i;
const exportFacts: string[] = [];
const exportLeaks: string[] = [];
for (const r of exportRoutes) {
  for (const path of r.path.includes(':name') ? ['sales', 'margin', 'stock-movements', 'payments', 'purchases'].map((n) => r.path.replace(':name', n)) : [r.path]) {
    const q = path.includes('attendance') ? `?month=${today.slice(0, 7)}` : path.includes('das') ? `?year=${today.slice(0, 4)}` : path.includes('overview') ? `?${range}` : `?${range}`;
    const own = await xlsxText(c.session.token, path + q);
    const low = await xlsxText(exporter.api.token, path + q);
    const words = low.status === 200 ? [...new Set(low.text.split(' | ').filter((t) => COSTWORD.test(t)))] : [];
    const figures = low.status === 200 ? secretFigures.filter((f) => (low.values ?? []).some((v) => String(Number(v)) === f) || low.text.includes(f)) : [];
    exportFacts.push(`${path}: owner ${own.status}, manager without VIEW_COST_AND_MARGIN ${low.status}${words.length ? ` — labels: ${words.slice(0, 6).join(', ')}` : ''}${figures.length ? ` — FIGURES: ${figures.join(', ')}` : ''}`);
    if (figures.length) exportLeaks.push(`${path}: ${figures.join(', ')}`);
  }
}
record({ name: `exports read: ${exportFacts.join(' ; ')}`, status: 'INFO' });
await check('no export gives the margin or the stock value to a user without VIEW_COST_AND_MARGIN', () => {
  assert(exportLeaks.length === 0, exportLeaks.join(' ; '));
});
await check('a user without EXPORT_DATA gets no export at all', async () => {
  const noExport = await invite(c, 'SELLER');
  const got: string[] = [];
  for (const path of ['/reports/sales/export.xlsx', '/reports/payments/export.xlsx', '/reports/aging/export.xlsx', '/reports/overview/export.xlsx', '/reports/charges/export.xlsx', '/reports/sell-out/export.xlsx']) {
    const res = await request(`${path}?${range}`, { token: noExport.api.token, raw: true });
    if (res.status !== 403) got.push(`${path} → ${res.status}`);
  }
  assert(got.length === 0, got.join(' ; '));
});

writeFileSync(`${OUT}scopes-detail.json`, JSON.stringify({ hits: allHits, exports: exportFacts }, null, 1));
writeSummary('scopes');
await closeDb();
process.exit(0);
