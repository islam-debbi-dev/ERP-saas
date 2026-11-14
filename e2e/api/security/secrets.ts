/**
 * Audit 02, part B.7: what is written to the logs and sent to Sentry.
 *
 * A second API is started for this file alone (port 3013, same audit database) with
 * SENTRY_DSN pointing at a local sink (lib/sentry-sink.ts) and its own log file. Requests
 * carrying marked secrets are sent, some of them made to fail with a 500 (finding 01-#2),
 * then the log and every Sentry envelope are searched for the marks.
 *
 *   tsx api/security/secrets.ts
 */
import { spawn } from 'node:child_process';
import { createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { area, assert, check, record, writeSummary } from '../../lib/harness.ts';
import { startSink } from '../../lib/sentry-sink.ts';
import { assertAuditDb, OUT, uniq } from '../../lib/audit.ts';
import { closeDb, query } from '../../lib/db.ts';
import { totp } from '../../lib/totp.ts';
import { DB } from '../../lib/config.ts';

assertAuditDb();
const PORT = 3013;
const BASE = `http://localhost:${PORT}`;
const LOG = `${OUT}api-secrets.log`;
const sink = await startSink(3098);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const api = spawn('sh', [`${root}e2e/map-stack.sh`, 'api'], {
  env: { ...process.env, AUDIT_DB: new URL(DB).pathname.slice(1), API_PORT: String(PORT), SENTRY_DSN: 'http://audit02@localhost:3098/1', LOG_LEVEL: 'debug', TRUST_PROXY: '1' },
});
const out = createWriteStream(LOG);
api.stdout.pipe(out);
api.stderr.pipe(out);
for (let i = 0; i < 60; i += 1) {
  if (await fetch(`${BASE}/health`).then((r) => r.ok).catch(() => false)) break;
  await new Promise((r) => setTimeout(r, 500));
}

const call = async (path: string, init: { method?: string; token?: string; body?: unknown; headers?: Record<string, string>; key?: boolean } = {}): Promise<{ status: number; raw: string; json: Record<string, unknown>; setCookie: string }> => {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      ...(init.key ? { 'Idempotency-Key': uniq('sec-key-') } : {}),
      ...(init.headers ?? {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const raw = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    /* not JSON */
  }
  return { status: res.status, raw, json, setCookie: res.headers.get('set-cookie') ?? '' };
};

// ------------------------------------------------------------------ marked secrets
const marks: Record<string, string> = {};
const tag = uniq('');
const PW = `Pw-${tag}-Secret1!`;
const PW2 = `Pw2-${tag}-Secret1!`;
const PW_WRONG = `PwWrong-${tag}-Secret1!`;
marks['owner password'] = PW;
marks['new password'] = PW2;
marks['a wrong password typed at login'] = PW_WRONG;

const email = `${uniq('sec')}@audit.local`;
const reg = await call('/auth/register', { method: 'POST', body: { companyName: `Secrets ${tag}`, fullName: 'Owner', email, password: PW, activity: 'DISTRIBUTEUR' }, headers: { 'X-Client-Type': 'native' } });
const token = reg.json['accessToken'] as string;
const tenantId = (reg.json['user'] as { tenantId: string }).tenantId;
marks['access token'] = token;
marks['refresh token'] = reg.json['refreshToken'] as string;
// Every module, so the HR and import routes answer (the audit super-admin, as in lib/audit.ts).
const admin = JSON.parse(readFileSync(fileURLToPath(new URL('../../.auth/audit02-admin.json', import.meta.url)), 'utf8')) as { email: string; password: string; secret: string };
const code = totp(admin.secret);
const adminLogin = await call('/admin/auth/login', { method: 'POST', body: { email: admin.email, password: admin.password, code }, headers: { 'X-Client-Type': 'native', 'X-Forwarded-For': '203.0.113.77' } });
marks['super-admin password'] = admin.password;
marks['super-admin TOTP secret'] = admin.secret;
marks['super-admin access token'] = adminLogin.json['accessToken'] as string;
await call(`/admin/tenants/${tenantId}/subscription`, { method: 'PATCH', token: adminLogin.json['accessToken'] as string, body: { isFree: true, edition: 'ENTREPRISE' } });

await call('/auth/login', { method: 'POST', body: { identifier: email, password: PW_WRONG }, headers: { 'X-Forwarded-For': '203.0.113.78' } });
const web = await call('/auth/login', { method: 'POST', body: { identifier: email, password: PW }, headers: { 'X-Forwarded-For': '203.0.113.79' } });
const cookie = /erp_rt=([^;]+)/.exec(web.setCookie)?.[1] ?? '';
marks['refresh cookie'] = decodeURIComponent(cookie);
await call('/auth/refresh', { method: 'POST', headers: { Cookie: `erp_rt=${cookie}` } });
await call('/auth/refresh', { method: 'POST', body: { refreshToken: reg.json['refreshToken'] }, headers: { 'X-Client-Type': 'native' } });

// An invited user with a temporary password, and one with a link.
const TEMP = `Temp-${tag}-Secret1!`;
marks['temporary password of an invited user'] = TEMP;
await call('/users/invite', { method: 'POST', token, body: { fullName: 'Invité mot de passe', email: `${uniq('p')}@audit.local`, role: 'SELLER', managerId: null, mode: 'PASSWORD', password: TEMP } });
// The same invitation made to fail with a 500 (a lone surrogate in the name), so the body reaches the error path.
const failingInvite = await call('/users/invite', { method: 'POST', token, body: { fullName: 'bad\uD800end', email: `${uniq('p')}@audit.local`, role: 'SELLER', managerId: null, mode: 'PASSWORD', password: TEMP } });
const inv = await call('/users/invite', { method: 'POST', token, body: { fullName: 'Invité lien', email: `${uniq('l')}@audit.local`, role: 'SELLER', managerId: null, mode: 'LINK' } });
const inviteToken = String(inv.json['inviteUrl']).split('/').pop()!;
marks['invitation link token'] = inviteToken;
await call(`/auth/invitations/${inviteToken}`);
const INVITED_PW = `Inv-${tag}-Secret1!`;
marks['password chosen through an invitation link'] = INVITED_PW;
await call(`/auth/invitations/${inviteToken}/accept`, { method: 'POST', body: { password: INVITED_PW }, headers: { 'X-Client-Type': 'native' } });
await call('/auth/password', { method: 'POST', token, body: { currentPassword: PW, newPassword: PW2 } });

// A cheque, an avance and a salary, each once valid and once made to fail with a 500.
const cl = await call('/clients', { method: 'POST', token, body: { code: uniq('C-'), name: 'Client chèque', type: 'PARTICULIER' } });
const CHEQUE = `CHQ${tag}9981`;
const BANK = `Banque-${tag}`;
marks['cheque number'] = CHEQUE;
marks['cheque bank'] = BANK;
const cheque = { clientId: cl.json['id'], mode: 'CHEQUE', reference: CHEQUE, bank: BANK, dueDate: '2026-12-31' };
const okPay = await call('/payments', { method: 'POST', token, key: true, body: { ...cheque, amount: '1234' } });
const badPay = await call('/payments', { method: 'POST', token, key: true, body: { ...cheque, amount: '9999999999999999.99' } });
const wh = (await call('/warehouses', { token })).json as unknown as { id: string; type: string }[];
const EMP = `Salarie-${tag}`;
const emp = await call('/employees', { method: 'POST', token, body: { fullName: EMP, hireDate: '2025-01-01', contract: 'CDI', declared: true, warehouseId: wh.find((w) => w.type === 'MAIN')?.id, rib: `RIB${tag}00799999` } });
const SALARY = '87654.32';
marks['salary amount'] = SALARY;
marks['employee RIB'] = `RIB${tag}00799999`;
const sal = await call(`/employees/${emp.json['id']}/salaries`, { method: 'POST', token, key: true, body: { amount: SALARY, payType: 'MONTHLY', effectiveFrom: '2025-01-01' } });
const badSal = await call(`/employees/${emp.json['id']}/salaries`, { method: 'POST', token, key: true, body: { amount: '9999999999999999.99', payType: 'MONTHLY', effectiveFrom: '2025-02-01', note: `salaire ${SALARY}` } });
const badAdv = await call(`/employees/${emp.json['id']}/advances`, { method: 'POST', token, key: true, body: { amount: '999999999999.99', mode: 'ESPECES', note: `avance ${SALARY}` } });

// A share link opened, and a position sent (phase 35 says it is never kept).
const p = await call('/products', { method: 'POST', token, key: true, body: { reference: uniq('P-'), designation: 'Article', baseUnitId: ((await call('/units', { token })).json as unknown as { id: string; code: string }[]).find((u) => u.code === 'PIECE')!.id, tvaRate: '19', minStock: '0', units: [], prices: [] } });
void p;
const rel = await call('/share-links', { method: 'POST', token, body: { docType: 'RELEVE', docId: cl.json['id'], from: '2026-10-01', to: '2026-11-14' } });
const shareToken = String(rel.json['url']).split('/').pop()!;
marks['share link token'] = shareToken;
const opened = await call(`/s/${shareToken}`);

record({
  name: `requests sent: register ${reg.status}, admin login ${adminLogin.status}, cheque ${okPay.status}, cheque made to fail ${badPay.status}, invite made to fail ${failingInvite.status}, salary ${sal.status}, salary made to fail ${badSal.status}, avance made to fail ${badAdv.status}, share link opened ${opened.status}`,
  status: 'INFO',
});

// ------------------------------------------------------------------ stop, then read
await new Promise((r) => setTimeout(r, 2500)); // let Sentry flush
api.kill('SIGTERM');
await new Promise((r) => setTimeout(r, 1500));
out.end();
const log = readFileSync(LOG, 'utf8');
const envelopes = sink.bodies.join('\n');
await sink.close();
// The raw envelopes hold the secrets themselves: kept out of git (.auth/ is ignored).
writeFileSync(fileURLToPath(new URL('../../.auth/audit02-sentry-envelopes.txt', import.meta.url)), sink.bodies.join('\n---\n'));

const found = (haystack: string): string[] => Object.entries(marks).filter(([, v]) => v && haystack.includes(v)).map(([k]) => k);
const events = sink.bodies.filter((b) => b.includes('"exception"')).length;

area('B7. Logs');
record({ name: `API log: ${log.split('\n').length} lines at level debug; ${(log.match(/"level":50/g) ?? []).length} error lines`, status: 'INFO' });
await check('no password, token, cookie, TOTP secret, cheque or salary is written to the API log', () => {
  const f = found(log);
  assert(f.length === 0, `in the log: ${f.join(', ')}`);
});
await check('the Authorization and Cookie headers are redacted in the log', () => {
  assert(/"authorization":"\[Redacted\]"/.test(log) && !/"cookie":"erp_rt=/.test(log), 'a header is logged in clear');
});
await check('a 500 logs its error without the request body', () => {
  const errors = log.split('\n').filter((l) => l.includes('"level":50'));
  const withBody = errors.filter((l) => /"body":|"password"|"amount":"9999/.test(l));
  assert(errors.length > 0, 'no 500 was logged: the check proved nothing');
  assert(withBody.length === 0, withBody[0]?.slice(0, 300) ?? '');
});

area('B7. Sentry');
record({ name: `${sink.bodies.length} envelope(s) received by the sink, ${events} with an exception`, status: 'INFO' });
await check('the 500s reached Sentry (or the check below proves nothing)', () => {
  assert(events > 0, 'no error event was received');
});
/** Where a mark sits in an envelope: the 260 characters before it, the mark itself masked. */
const where = (haystack: string, key: string): string => {
  const i = haystack.indexOf(marks[key]!);
  let context = haystack.slice(Math.max(0, i - 260), i).replace(/\s+/g, ' ');
  for (const [k, v] of Object.entries(marks)) if (v) context = context.split(v).join(`<${k.toUpperCase()}>`);
  return `${key}: …${context}<${key.toUpperCase()}>`;
};
writeFileSync(`${OUT}sentry-leaks.txt`, found(envelopes).map((k) => where(envelopes, k)).join('\n\n') || 'nothing found');
await check('no password, token, cookie, cheque or salary is sent to Sentry', () => {
  const f = found(envelopes);
  assert(f.length === 0, `sent to Sentry: ${f.join(', ')}`);
});
await check('a Sentry event carries no request body, no cookie and no Authorization header', () => {
  // An error event has request.data; a trace span has the attribute http.request.body.data.
  const inEvent = /"method":"(POST|PUT|PATCH)","url":"[^"]+","cookies":\{[^}]*\},"data":"/.test(envelopes);
  const inSpan = (envelopes.match(/"http\.request\.body\.data"/g) ?? []).length;
  record({ name: `request bodies in Sentry: in the error event ${inEvent ? 'yes' : 'no'}; in ${inSpan} trace span(s) (tracesSampleRate 0.1, so one request in ten)`, status: 'INFO' });
  const body = inEvent || inSpan > 0;
  const auth = /"authorization":"Bearer /i.test(envelopes);
  const cookies = /"cookies":\{"erp_rt"|"cookie":"erp_rt=/i.test(envelopes);
  const ip = /"ip_address":"(?!\{\{auto\}\})[^"]+"/.exec(envelopes)?.[0] ?? null;
  record({ name: `Sentry event: request body ${body ? 'present' : 'absent'}, Authorization ${auth ? 'present' : 'absent'}, cookies ${cookies ? 'present' : 'absent'}, user ip ${ip ?? 'absent'}`, status: 'INFO' });
  assert(!body && !auth && !cookies, `body ${body}, authorization ${auth}, cookies ${cookies}`);
});

area('B7. Database');
await check('passwords are argon2 hashes; refresh tokens, invitation links and share links are stored as hashes only', async () => {
  const rows = await query<{ t: string }>(
    `SELECT (SELECT string_agg(to_jsonb(u)::text, ' ') FROM users u WHERE u."tenantId" = $1::uuid)
         || (SELECT COALESCE(string_agg(to_jsonb(s)::text, ' '), '') FROM sessions s WHERE s."tenantId" = $1::uuid)
         || (SELECT COALESCE(string_agg(to_jsonb(i)::text, ' '), '') FROM user_invitations i WHERE i."tenantId" = $1::uuid)
         || (SELECT COALESCE(string_agg(to_jsonb(l)::text, ' '), '') FROM share_links l WHERE l."tenantId" = $1::uuid)
         || (SELECT COALESCE(string_agg(to_jsonb(a)::text, ' '), '') FROM audit_logs a WHERE a."tenantId" = $1::uuid) AS t`,
    [tenantId],
  );
  const text = rows[0]!.t;
  const f = ['owner password', 'new password', 'temporary password of an invited user', 'password chosen through an invitation link', 'invitation link token', 'share link token', 'access token'].filter((k) => text.includes(marks[k]!));
  const refreshSecret = String(marks['refresh token']).split('.')[1]!;
  assert(f.length === 0 && !text.includes(refreshSecret), `stored in clear: ${f.join(', ')}${text.includes(refreshSecret) ? ', refresh token secret' : ''}`);
  assert(/\$argon2id\$/.test(text), 'the password hash is not argon2id');
});

writeSummary('secrets');
await closeDb();
process.exit(0);
