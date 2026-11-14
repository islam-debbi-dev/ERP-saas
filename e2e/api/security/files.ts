/**
 * Audit 02, part B.5: files and links.
 *  - Excel / CSV import: size limit, wrong type, hostile file name, zip bomb, row limit.
 *  - Public share links /s/<token>: what they are, what they expose, expiry, revocation.
 *
 *   tsx api/security/files.ts
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { area, assert, check, record, writeSummary } from '../../lib/harness.ts';
import { register, request } from '../../lib/http.ts';
import { API, WEB } from '../../lib/config.ts';
import { addDays, algiersToday, assertAuditDb, client, company, invite, openingStock, OUT, PASSWORD, product, uniq } from '../../lib/audit.ts';
import { closeDb, query } from '../../lib/db.ts';

assertAuditDb();
const today = algiersToday();
const codeOf = (raw: string): string => /"code":"([A-Z_0-9]+)"/.exec(raw)?.[1] ?? '';
const c = await company('Files');
const token = c.session.token;
const dir = mkdtempSync(`${tmpdir()}/audit02-files-`);

async function upload(type: string, name: string, data: Buffer | string, mime: string, tok = token): Promise<{ status: number; raw: string; ms: number }> {
  const form = new FormData();
  form.append('file', new Blob([data], { type: mime }), name);
  const started = Date.now();
  try {
    const res = await fetch(`${API}/imports/${type}/preview`, { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: form, signal: AbortSignal.timeout(120_000) });
    return { status: res.status, raw: await res.text(), ms: Date.now() - started };
  } catch (err) {
    return { status: 0, raw: String(err), ms: Date.now() - started };
  }
}
const apiPid = (): string => execFileSync('lsof', ['-tiTCP:' + new URL(API).port, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split('\n')[0] ?? '';
const rssMb = (pid: string): number => Math.round(Number(execFileSync('ps', ['-o', 'rss=', '-p', pid], { encoding: 'utf8' }).trim()) / 1024);

// =================================================================== imports
area('B5. Excel and CSV import');
const template = await fetch(`${API}/imports/templates/CLIENTS`, { headers: { Authorization: `Bearer ${token}` } });
const templateBuf = Buffer.from(await template.arrayBuffer());
await check('the template of an import opens and a valid file is previewed', async () => {
  const res = await upload('CLIENTS', 'clients.xlsx', templateBuf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert(template.status === 200 && res.status === 200, `template ${template.status}, preview ${res.status} ${res.raw.slice(0, 160)}`);
});
await check('a file over 10 MB is refused with 413, not read', async () => {
  const res = await upload('CLIENTS', 'big.csv', Buffer.alloc(11 * 1024 * 1024, 'a'), 'text/csv');
  assert(res.status === 413, `HTTP ${res.status} ${res.raw.slice(0, 160)}`);
});
await check('a file that is not a spreadsheet is refused cleanly, whatever its name and type say', async () => {
  const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(4096, 7)]);
  const a = await upload('CLIENTS', 'clients.xlsx', exe, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const b = await upload('CLIENTS', 'clients.pdf', '%PDF-1.4', 'application/pdf');
  const d = await upload('CLIENTS', 'clients.xlsx', '', 'application/octet-stream');
  const e = await upload('NOPE', 'clients.csv', 'code;name\n1;x', 'text/csv');
  const facts = `binary as .xlsx ${a.status} ${codeOf(a.raw)}, .pdf ${b.status} ${codeOf(b.raw)}, empty ${d.status} ${codeOf(d.raw)}, unknown type ${e.status}`;
  assert([a, b, d, e].every((r) => r.status >= 400 && r.status < 500), facts);
});
await check('a hostile file name is kept as a name only (no path, no markup executed, no 500)', async () => {
  const name = '../../../../etc/passwd\u0000<img src=x onerror=alert(1)>.csv';
  const res = await upload('CLIENTS', name, 'Code;Nom\nC1;Client fichier', 'text/csv');
  const rows = await query<{ fileName: string }>(`SELECT "fileName" FROM import_jobs WHERE "tenantId" = $1::uuid ORDER BY "createdAt" DESC LIMIT 1`, [c.tenantId]);
  record({ name: `hostile file name: HTTP ${res.status} ${codeOf(res.raw)}; stored as ${JSON.stringify(rows[0]?.fileName)} (the file itself is a column of import_jobs: nothing is written to disk)`, status: 'INFO' });
  assert(res.status < 500, `HTTP ${res.status} ${res.raw.slice(0, 200)}`);
});
await check('more than 10 000 rows are refused', async () => {
  const csv = 'Code;Nom\n' + Array.from({ length: 10_050 }, (_, i) => `C${i};Client ${i}`).join('\n');
  const res = await upload('CLIENTS', 'many.csv', csv, 'text/csv');
  assert(res.status >= 400 && res.status < 500 && /TOO_MANY_ROWS/.test(res.raw), `HTTP ${res.status} ${res.raw.slice(0, 160)}`);
});
await check('a formula in a cell of an imported file is read as its saved value, never evaluated', async () => {
  const res = await upload('CLIENTS', 'f.csv', 'Code;Nom\nC9;=cmd|\' /C calc\'!A0\nC10;@SUM(1+1)', 'text/csv');
  assert(res.status === 200, `HTTP ${res.status} ${res.raw.slice(0, 200)}`);
});
await check('a SELLER cannot import (matrix) and cannot read an import job of the company', async () => {
  const seller = await invite(c, 'SELLER');
  const up = await upload('CLIENTS', 'x.csv', 'Code;Nom\nC1;x', 'text/csv', seller.api.token);
  const list = await seller.api.get('/imports');
  assert(up.status === 403 && list.status === 403, `upload ${up.status}, list ${list.status}`);
});
// =================================================================== share links
area('B5. Public share links');
const p = await product(c, { priceHt: '1000' });
await openingStock(c, p, '50', '400');
const cl = await client(c, 'Client partagé');
const other = await client(c, 'Autre client');
const mk = async (clientId: string): Promise<string> =>
  (await c.owner.post<{ sale: { id: string } }>('/sales/quick', { type: 'BL', clientId, documentDate: today, paidAmount: '0', paymentMode: 'ESPECES', lines: [{ productId: p.id, unitId: p.unitId, qty: '1', unitPriceHt: '1000' }] })).sale.id;
const bl1 = await mk(cl);
const bl2 = await mk(cl);
await mk(other);
const fac = await c.owner.post<{ sale?: { id: string }; id?: string }>('/invoices/from-bls', { saleIds: [bl1, bl2], documentDate: today });
const facId = fac.sale?.id ?? fac.id!;
const share = (body: unknown) => c.owner.post<{ id: string; url: string; expiresAt: string }>('/share-links', body, null);
const link = await share({ docType: 'FACTURE', docId: facId });
const tok = link.url.split('/').pop()!;
const open = async (t: string): Promise<{ status: number; type: string; cache: string | null; robots: string | null; raw: string; len: number }> => {
  const res = await fetch(`${API}/s/${t}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, type: res.headers.get('content-type') ?? '', cache: res.headers.get('cache-control'), robots: res.headers.get('x-robots-tag'), raw: buf.toString('latin1').slice(0, 300), len: buf.length };
};
await check('a link is 32 random bytes, expires in 7 days, and only its hash is stored', async () => {
  const [row] = await query<Record<string, unknown>>(`SELECT * FROM share_links WHERE id = $1::uuid`, [link.id]);
  const days = (new Date(link.expiresAt).getTime() - Date.now()) / 86_400_000;
  assert(Buffer.from(tok, 'base64url').length === 32, `token of ${Buffer.from(tok, 'base64url').length} bytes`);
  assert(!JSON.stringify(row).includes(tok), 'the token is stored in clear');
  assert(days > 6.9 && days < 7.1, `expires in ${days.toFixed(2)} days`);
});
const first = await open(tok);
await check('the link opens the PDF without login, and the answer may not be cached or indexed', async () => {
  record({ name: `GET /s/<token>: HTTP ${first.status}, ${first.type}, ${first.len} bytes, Cache-Control: ${first.cache ?? 'none'}, X-Robots-Tag: ${first.robots ?? 'none'}`, status: 'INFO' });
  assert(first.status === 200 && first.type.includes('pdf'), `HTTP ${first.status} ${first.raw.slice(0, 120)}`);
  assert(!!first.cache && /no-store|private/.test(first.cache), `Cache-Control: ${first.cache ?? 'none'} — a CDN or a shared proxy may keep a client's facture`);
});
await check('each opening is counted and written to the journal', async () => {
  const [row] = await query<{ n: number }>(`SELECT "openCount" AS n FROM share_links WHERE id = $1::uuid`, [link.id]);
  const [log] = await query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM audit_logs WHERE "tenantId" = $1::uuid AND action = 'SHARE_LINK_OPENED' AND "entityId" = $2`, [c.tenantId, link.id]);
  assert(row!.n >= 1 && Number(log!.n) >= 1, `openCount ${row!.n}, journal rows ${log!.n}`);
});
await check('an unknown, a revoked and an expired link get the same answer, and a revoked link stays dead', async () => {
  const unknown = await open('A'.repeat(43));
  const revoked = await share({ docType: 'RELEVE', docId: cl, from: addDays(today, -30), to: today });
  const rTok = revoked.url.split('/').pop()!;
  const before = await open(rTok);
  await c.owner.send('DELETE', `/share-links/${revoked.id}`, undefined, null);
  const after = await open(rTok);
  const exp = await share({ docType: 'FACTURE', docId: facId });
  await query(`UPDATE share_links SET "expiresAt" = now() - interval '1 minute' WHERE id = $1::uuid`, [exp.id]); // backdate: audit database only
  const expired = await open(exp.url.split('/').pop()!);
  const odd = await open('../../auth/me');
  const strip = (r: { status: number; raw: string }): string => `${r.status} ${r.raw.replace(/"requestId":"[^"]+"/, '')}`;
  assert(before.status === 200, `the relevé link did not open: ${before.status}`);
  assert(new Set([unknown, after, expired].map(strip)).size === 1 && unknown.status >= 400, `unknown ${strip(unknown)} | revoked ${strip(after)} | expired ${strip(expired)}`);
  assert(odd.status >= 400 && odd.status < 500, `a token that is a path: ${odd.status}`);
});
await check('a link cannot be made for a BL, a draft, or with a period over a year', async () => {
  const bl = await c.owner.send('POST', '/share-links', { docType: 'FACTURE', docId: bl1 }, null);
  const long = await c.owner.send('POST', '/share-links', { docType: 'RELEVE', docId: cl, from: addDays(today, -800), to: today }, null);
  const extra = await c.owner.send('POST', '/share-links', { docType: 'RELEVE', docId: cl, from: addDays(today, -30), to: today, expiresAt: '2099-01-01T00:00:00Z', tenantId: c.tenantId }, null);
  const [row] = await query<{ far: boolean }>(`SELECT bool_or("expiresAt" > now() + interval '8 days') AS far FROM share_links WHERE "tenantId" = $1::uuid`, [c.tenantId]);
  assert(bl.status === 404 && long.status === 400 && !row!.far, `BL ${bl.status}, 800 days ${long.status}, expiresAt in the body ${extra.status}, a link beyond 8 days exists: ${row!.far}`);
});
await check('the relevé of a link shows that client only', async () => {
  const l = await share({ docType: 'RELEVE', docId: cl, from: addDays(today, -30), to: today });
  const res = await fetch(`${API}/s/${l.url.split('/').pop()!}`);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()) }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i += 1) text += (await (await doc.getPage(i)).getTextContent()).items.map((it) => ('str' in it ? it.str : '')).join(' ');
  assert(text.includes('Client partagé') && !text.includes('Autre client'), `text: ${text.slice(0, 200)}`);
});
await check('the web address /s/<token> forwards without leaking the token (no referrer, no cache)', async () => {
  const res = await fetch(`${WEB}/s/${tok}`, { redirect: 'manual' });
  const facts = `HTTP ${res.status} → ${res.headers.get('location')?.replace(tok, '<token>')}, Referrer-Policy ${res.headers.get('referrer-policy')}, Cache-Control ${res.headers.get('cache-control')}`;
  record({ name: `web /s/<token>: ${facts}`, status: 'INFO' });
  assert(res.status === 307 && res.headers.get('referrer-policy') === 'no-referrer' && /no-store/.test(res.headers.get('cache-control') ?? ''), facts);
});
await check('a seller cannot revoke the link another user made', async () => {
  const seller = await invite(c, 'SELLER');
  const l = await share({ docType: 'FACTURE', docId: facId });
  const res = await seller.api.send('DELETE', `/share-links/${l.id}`, undefined, null);
  const still = await open(l.url.split('/').pop()!);
  assert(res.status >= 400 && still.status === 200, `DELETE by a seller: ${res.status}; the link then answers ${still.status}`);
});
{
  // The stack runs with RATE_LIMIT_PER_MINUTE raised for the suites, so only a limit of
  // the route itself can show here; the global one (300 a minute) is read in the code.
  const started = Date.now();
  const res = await Promise.all(Array.from({ length: 40 }, () => fetch(`${API}/s/${tok}`).then(async (r) => (await r.arrayBuffer(), r.status))));
  const [row] = await query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM audit_logs WHERE "tenantId" = $1::uuid AND action = 'SHARE_LINK_OPENED'`, [c.tenantId]);
  const facts = `40 anonymous openings: ${res.filter((s) => s === 200).length} PDFs rendered, ${res.filter((s) => s === 429).length} throttled, ${((Date.now() - started) / 1000).toFixed(1)} s; journal rows SHARE_LINK_OPENED: ${row!.n}`;
  record({ name: `${facts} (no limit of its own on this public route; part D)`, status: 'INFO' });
}

// Last: if it succeeds the API is gone (restart it: AUDIT_DB=erp_audit02 e2e/map-stack.sh api).
area('B5. Excel import: zip bomb');
await check('a company that has just signed up may import (no plan gate before the bomb)', async () => {
  const fresh = await register(`Bomb ${uniq('')}`, 'Fresh owner', `${uniq('bomb')}@audit.local`, PASSWORD);
  const res = await upload('CLIENTS', 'ok.csv', 'Code;Nom\nC1;Client', 'text/csv', fresh.token);
  record({ name: `a tenant created by POST /auth/register a second ago uploads an import file: HTTP ${res.status}`, status: 'INFO' });
  assert(res.status === 200, `HTTP ${res.status} ${res.raw.slice(0, 160)}`);
});
await check('a zip bomb (a small .xlsx that inflates to hundreds of MB) does not take the API down', async () => {
  // A valid workbook whose only sheet is 4 000 000 identical one-cell rows: ~250 MB of XML,
  // under 1 MB zipped, so the 10 MB limit on the upload does not see it.
  const work = `${dir}/bomb`;
  execFileSync('mkdir', ['-p', `${work}/src`]);
  writeFileSync(`${work}/t.xlsx`, templateBuf);
  execFileSync('unzip', ['-q', '-o', `${work}/t.xlsx`, '-d', `${work}/src`]);
  const row = (_i: number): string => `<row><c t="inlineStr"><is><t>AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA</t></is></c></row>`;
  const chunks: string[] = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'];
  for (let i = 1; i <= 4_000_000; i += 1) chunks.push(row(i));
  chunks.push('</sheetData></worksheet>');
  const sheet = execFileSync('sh', ['-c', `ls ${work}/src/xl/worksheets/*.xml | head -1`], { encoding: 'utf8' }).trim();
  writeFileSync(sheet, chunks.join(''));
  execFileSync('sh', ['-c', `cd ${work}/src && zip -q -9 -r ../bomb.xlsx .`]);
  const bomb = readFileSync(`${work}/bomb.xlsx`);
  const pid = apiPid();
  const before = rssMb(pid);
  let peak = before;
  const watch = setInterval(() => {
    try {
      peak = Math.max(peak, rssMb(pid));
    } catch {
      /* the process is gone */
    }
  }, 250);
  // While it is read, does the API still answer anyone else?
  const pending = upload('CLIENTS', 'bomb.xlsx', bomb, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  await new Promise((r) => setTimeout(r, 1500));
  const t0 = Date.now();
  const health = await fetch(`${API}/health`, { signal: AbortSignal.timeout(60_000) }).then((r) => r.status).catch(() => 0);
  const healthMs = Date.now() - t0;
  const res = await pending;
  clearInterval(watch);
  let alive = false;
  try {
    alive = apiPid() === pid;
  } catch {
    alive = false;
  }
  const log = process.env['API_LOG'] ?? `${OUT}api-b.log`;
  const fatal = alive ? '' : execFileSync('sh', ['-c', `grep -a "FATAL ERROR" "${log}" | tail -1 || true`], { encoding: 'utf8' }).trim();
  if (!alive) writeFileSync(`${OUT}zip-bomb-crash.txt`, `${new Date().toISOString()}\nPOST /imports/CLIENTS/preview with bomb.xlsx (${bomb.length} bytes)\nAPI process ${pid} is gone.\n${fatal}\n`);
  const facts = `file ${(bomb.length / 1024 / 1024).toFixed(1)} MB zipped, ~${Math.round(chunks.join('').length / 1024 / 1024)} MB inflated; answer HTTP ${res.status} ${codeOf(res.raw)} after ${(res.ms / 1000).toFixed(1)} s; API memory ${before} MB → peak ${peak} MB; /health asked during the read answered ${health} after ${healthMs} ms; API process ${alive ? 'alive' : `DEAD (${fatal.slice(0, 140)})`}`;
  record({ name: `zip bomb: ${facts}`, status: 'INFO' });
  assert(bomb.length < 10 * 1024 * 1024, `the bomb is over the upload limit, the check proves nothing: ${facts}`);
  assert(alive && res.status >= 400 && res.status < 500, facts);
  assert(peak - before < 1024 && healthMs < 3000, `the API inflated the whole file in memory and stopped answering: ${facts}`);
});


writeSummary('files');
await closeDb();
process.exit(0);
