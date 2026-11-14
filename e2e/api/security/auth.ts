/**
 * Audit 02, part B.3: authentication and sessions.
 * The login limiter and the refresh rotation are already in attacks.ts (area F); this file
 * adds what audit 01 did not look at.
 *
 *   tsx api/security/auth.ts
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { area, assert, check, record, writeSummary } from '../../lib/harness.ts';
import { call, login, request } from '../../lib/http.ts';
import { API } from '../../lib/config.ts';
import { assertAuditDb, company, invite, PASSWORD, uniq } from '../../lib/audit.ts';
import { closeDb, query } from '../../lib/db.ts';
import { totp } from '../../lib/totp.ts';

assertAuditDb();
const code = (raw: string): string => /"code":"([A-Z_0-9]+)"/.exec(raw)?.[1] ?? '';
let ipSeq = 0;
/** The login limiter counts per address; finding 01-#4 lets a caller choose his own. */
const ip = (): Record<string, string> => ({ 'X-Forwarded-For': `203.0.113.${(ipSeq += 1) % 250}`, 'X-Client-Type': 'native' });
const b64 = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString('base64url');
const sign = (payload: Record<string, unknown>, secret: string, alg = 'HS256'): string => {
  const head = `${b64({ alg, typ: 'JWT' })}.${b64(payload)}`;
  return `${head}.${alg === 'none' ? '' : createHmac('sha256', secret).update(head).digest('base64url')}`;
};
const claims = (token: string): Record<string, unknown> => JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as Record<string, unknown>;
const envFile = readFileSync(fileURLToPath(new URL('../../../apps/api/.env', import.meta.url)), 'utf8');
const SECRET = /^JWT_ACCESS_SECRET=(.*)$/m.exec(envFile)![1]!.trim();
const EXAMPLE_SECRET = /^JWT_ACCESS_SECRET=(.*)$/m.exec(readFileSync(fileURLToPath(new URL('../../../apps/api/.env.example', import.meta.url)), 'utf8'))![1]!.trim();

const c = await company('Auth');
const now = Math.floor(Date.now() / 1000);

// =================================================================== tokens
area('B3. Access tokens');
await check('an expired access token is refused (TOKEN_EXPIRED)', async () => {
  const expired = sign({ ...claims(c.session.token), iat: now - 7200, exp: now - 3600 }, SECRET);
  const res = await request('/auth/me', { token: expired });
  assert(res.status === 401 && code(res.raw) === 'TOKEN_EXPIRED', `HTTP ${res.status} ${res.raw.slice(0, 120)}`);
});
await check('alg "none" and a token signed with another secret are refused', async () => {
  const none = await request('/auth/me', { token: sign(claims(c.session.token), '', 'none') });
  const other = await request('/auth/me', { token: sign(claims(c.session.token), 'x'.repeat(40)) });
  assert(none.status === 401 && other.status === 401, `none ${none.status}, other secret ${other.status}`);
});
await check('a valid signature is not enough: the role and the company come from the session row', async () => {
  const seller = await invite(c, 'SELLER');
  const forgedRole = sign({ ...claims(seller.api.token), role: 'OWNER' }, SECRET);
  const asOwner = await request('/users', { token: forgedRole });
  const other = await company('AuthOther');
  const forgedTenant = sign({ ...claims(seller.api.token), tid: other.tenantId }, SECRET);
  const cross = await request('/clients', { token: forgedTenant });
  assert(asOwner.status === 403, `role OWNER written in the token: HTTP ${asOwner.status}`);
  assert(cross.status === 401, `another tid written in the token: HTTP ${cross.status} ${cross.raw.slice(0, 100)}`);
});
await check('the API refuses to start in production with the JWT secret published in .env.example', () => {
  // The audited API runs with NODE_ENV=production (e2e/map-stack.sh) and the developer's
  // apps/api/.env; it is up, so if that secret is the example one, nothing refused it.
  assert(SECRET !== EXAMPLE_SECRET, 'the API is running with NODE_ENV=production and JWT_ACCESS_SECRET equal to the value of .env.example (config/app-config.ts only checks its length)');
});

// =================================================================== sessions
area('B3. Sessions: logout, revocation, password change');
await check('logout kills the access token and the refresh token of that session', async () => {
  const u = await invite(c, 'SELLER');
  const s = await login(u.email, PASSWORD);
  await call('/auth/logout', { method: 'POST', token: s.token });
  const me = await request('/auth/me', { token: s.token });
  const rf = await request('/auth/refresh', { method: 'POST', headers: { 'X-Client-Type': 'native' }, body: { refreshToken: s.refreshToken } });
  assert(me.status === 401 && rf.status === 401, `access ${me.status} ${code(me.raw)}, refresh ${rf.status} ${code(rf.raw)}`);
});
await check('a session revoked by the owner dies at once; a seller cannot revoke another user', async () => {
  const u = await invite(c, 'SELLER');
  const v = await invite(c, 'SELLER');
  const sid = claims(u.api.token)['sid'] as string;
  const byPeer = await v.api.send('DELETE', `/sessions/${sid}`, undefined, null);
  const stillIn = await u.api.get('/auth/me');
  const byOwner = await c.owner.send('DELETE', `/sessions/${sid}`, undefined, null);
  const out = await u.api.get('/auth/me');
  assert(byPeer.status === 404 && stillIn.status === 200, `a peer revoking: ${byPeer.status}, victim still in: ${stillIn.status}`);
  assert(byOwner.status === 204 && out.status === 401, `owner revoking: ${byOwner.status}, then ${out.status}`);
});
await check('a password change closes every other session of the user', async () => {
  const u = await invite(c, 'SELLER');
  const a = await login(u.email, PASSWORD);
  const b = await login(u.email, PASSWORD);
  await call('/auth/password', { method: 'POST', token: a.token, body: { currentPassword: PASSWORD, newPassword: 'Changed1234!' } });
  const other = await request('/auth/me', { token: b.token });
  const old = await request('/auth/login', { method: 'POST', headers: ip(), body: { identifier: u.email, password: PASSWORD } });
  assert(other.status === 401 && old.status === 401, `other session ${other.status}, old password ${old.status}`);
});
await check('a role change and a deactivation apply to a token already issued', async () => {
  const u = await invite(c, 'MANAGER');
  const before = await u.api.get('/audit-logs');
  await c.owner.put(`/users/${u.id}`, { fullName: 'Rétrogradé', email: u.email, role: 'SELLER', managerId: null });
  const after = await u.api.get('/audit-logs');
  await c.owner.post(`/users/${u.id}/deactivate`, {}, null);
  const gone = await u.api.get('/auth/me');
  assert(before.status === 200 && after.status === 403 && gone.status === 401, `manager ${before.status}, demoted ${after.status}, deactivated ${gone.status}`);
});

// =================================================================== invitations and resets
area('B3. Invitation and reset links');
const newLink = async (): Promise<{ id: string; email: string; token: string }> => {
  const email = `${uniq('inv')}@audit.local`;
  const inv = await c.owner.post<{ user: { id: string }; inviteUrl: string }>('/users/invite', { fullName: 'Invité', email, role: 'SELLER', managerId: null, mode: 'LINK' }, null);
  return { id: inv.user.id, email, token: inv.inviteUrl.split('/').pop()! };
};
const accept = (token: string, password = PASSWORD) => request('/auth/invitations/' + token + '/accept', { method: 'POST', headers: { 'X-Client-Type': 'native' }, body: { password } });
await check('an invitation link works once', async () => {
  const l = await newLink();
  const first = await accept(l.token);
  const second = await accept(l.token, 'Another1234!');
  const info = await request(`/auth/invitations/${l.token}`);
  const stolen = await request('/auth/login', { method: 'POST', headers: ip(), body: { identifier: l.email, password: 'Another1234!' } });
  assert(first.status === 200 && second.status >= 400 && info.status >= 400 && stolen.status === 401, `first ${first.status}, second ${second.status}, info ${info.status}, login with the second password ${stolen.status}`);
});
await check('twenty simultaneous uses of one link: one wins', async () => {
  const l = await newLink();
  const res = await Promise.all(Array.from({ length: 20 }, (_, i) => accept(l.token, `Race${i}Pass1234!`)));
  const ok = res.filter((r) => r.status === 200).length;
  assert(ok === 1 && res.every((r) => r.status < 500), `statuses ${res.map((r) => r.status).join(',')}`);
});
await check('an expired link, a replaced link and the link of a deactivated user are refused, with the same answer as an unknown one', async () => {
  const unknown = await accept('A'.repeat(43));
  const exp = await newLink();
  await query(`UPDATE user_invitations SET "expiresAt" = now() - interval '1 minute' WHERE "userId" = $1::uuid`, [exp.id]); // backdate: audit database only
  const expired = await accept(exp.token);
  const rep = await newLink();
  const again = await c.owner.post<{ inviteUrl: string }>(`/users/${rep.id}/reset-password`, { mode: 'LINK' }, null);
  const replaced = await accept(rep.token);
  const fresh = await accept(again.inviteUrl.split('/').pop()!);
  const dead = await newLink();
  await c.owner.post(`/users/${dead.id}/deactivate`, {}, null);
  const deactivated = await accept(dead.token);
  const same = (r: { status: number; raw: string }): string => `${r.status} ${code(r.raw)} ${/"message":"([^"]+)"/.exec(r.raw)?.[1]}`;
  assert(fresh.status === 200, `the new link does not work: ${fresh.status}`);
  assert(new Set([unknown, expired, replaced, deactivated].map(same)).size === 1 && unknown.status >= 400, `unknown: ${same(unknown)} | expired: ${same(expired)} | replaced: ${same(replaced)} | deactivated: ${same(deactivated)}`);
});
await check('only the hash of a link is stored, and the link is 32 random bytes', async () => {
  const l = await newLink();
  const [row] = await query<Record<string, unknown>>(`SELECT * FROM user_invitations WHERE "userId" = $1::uuid`, [l.id]);
  assert(Buffer.from(l.token, 'base64url').length === 32, `token of ${Buffer.from(l.token, 'base64url').length} bytes`);
  assert(!JSON.stringify(row).includes(l.token), 'the link itself is in the database');
});
await check('a reset link logs the old password and the old sessions out', async () => {
  const u = await invite(c, 'SELLER');
  const reset = await c.owner.post<{ inviteUrl: string }>(`/users/${u.id}/reset-password`, { mode: 'LINK' }, null);
  const session = await u.api.get('/auth/me');
  const oldPw = await request('/auth/login', { method: 'POST', headers: ip(), body: { identifier: u.email, password: PASSWORD } });
  const ok = await accept(reset.inviteUrl.split('/').pop()!, 'Fresh1234!');
  assert(session.status === 401 && oldPw.status === 401 && ok.status === 200, `old session ${session.status}, old password ${oldPw.status}, link ${ok.status}`);
});

// =================================================================== enumeration and lock-out
area('B3. User enumeration and account lock-out');
const known = await Promise.all([1, 2, 3, 4].map(() => invite(c, 'SELLER')));
await check('a wrong password and an unknown account get the same answer', async () => {
  const a = await request('/auth/login', { method: 'POST', headers: ip(), body: { identifier: known[0]!.email, password: 'Wrong1234!' } });
  const b = await request('/auth/login', { method: 'POST', headers: ip(), body: { identifier: `${uniq('ghost')}@audit.local`, password: 'Wrong1234!' } });
  const strip = (raw: string): string => raw.replace(/"requestId":"[^"]+"/, '');
  assert(a.status === b.status && strip(a.raw) === strip(b.raw), `known: ${a.status} ${a.raw} | unknown: ${b.status} ${b.raw}`);
});
await check('response time does not tell a known account from an unknown one (median of 12 each)', async () => {
  const time = async (identifier: string): Promise<number> => {
    const t = performance.now();
    await request('/auth/login', { method: 'POST', headers: ip(), body: { identifier, password: 'Wrong1234!' } });
    return performance.now() - t;
  };
  const k: number[] = [];
  const u: number[] = [];
  for (let i = 0; i < 12; i += 1) {
    // Three wrong passwords per known account: under the lock threshold of five.
    k.push(await time(known[i % 4]!.email));
    u.push(await time(`${uniq('ghost')}@audit.local`));
  }
  const med = (x: number[]): number => [...x].sort((a, b) => a - b)[Math.floor(x.length / 2)]!;
  record({ name: `login timing: known ${med(k).toFixed(0)} ms, unknown ${med(u).toFixed(0)} ms`, status: 'INFO' });
  assert(Math.abs(med(k) - med(u)) < Math.max(25, med(u) * 0.35), `known ${med(k).toFixed(0)} ms, unknown ${med(u).toFixed(0)} ms`);
});
await check('the lock-out does not tell whether an account exists', async () => {
  const victim = await invite(c, 'SELLER');
  const ghost = `${uniq('ghost')}@audit.local`;
  const hammer = async (identifier: string): Promise<string[]> => {
    const out: string[] = [];
    for (let i = 0; i < 7; i += 1) out.push(code((await request('/auth/login', { method: 'POST', headers: ip(), body: { identifier, password: 'Wrong1234!' } })).raw));
    return out;
  };
  const a = await hammer(victim.email);
  const b = await hammer(ghost);
  assert(a.join() === b.join(), `existing account: ${a.join(',')} | unknown: ${b.join(',')}`);
});
await check('an anonymous visitor cannot lock a user out of his account (the right password still works)', async () => {
  const victim = await invite(c, 'SELLER');
  for (let i = 0; i < 5; i += 1) await request('/auth/login', { method: 'POST', headers: ip(), body: { identifier: victim.email, password: 'Wrong1234!' } });
  const right = await request('/auth/login', { method: 'POST', headers: ip(), body: { identifier: victim.email, password: PASSWORD } });
  const [row] = await query<{ until: string }>(`SELECT "lockedUntil"::text AS until FROM users WHERE id = $1::uuid`, [victim.id]);
  assert(right.status === 200, `5 wrong passwords from 5 addresses, then the right one: HTTP ${right.status} ${code(right.raw)}, lockedUntil ${row?.until}`);
});
await check('registration does not tell whether an email is already used', async () => {
  const res = await request('/auth/register', { method: 'POST', headers: ip(), body: { companyName: 'Probe', fullName: 'Probe', email: c.session.email, password: PASSWORD } });
  assert(code(res.raw) !== 'EMAIL_ALREADY_USED', `HTTP ${res.status} ${res.raw.slice(0, 140)}`);
});

// =================================================================== cookies, CSRF, CORS
area('B3. Cookies, CSRF, CORS, headers');
const webLogin = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ip(), 'X-Client-Type': 'web' }, body: JSON.stringify({ identifier: c.session.email, password: PASSWORD }) });
const setCookie = webLogin.headers.get('set-cookie') ?? '';
const cookie = /erp_rt=[^;]+/.exec(setCookie)?.[0] ?? '';
await check('the refresh cookie is HttpOnly, SameSite=Lax, limited to /auth, and the web answer carries no refresh token', async () => {
  const body = (await webLogin.json()) as Record<string, unknown>;
  assert(/HttpOnly/i.test(setCookie) && /SameSite=Lax/i.test(setCookie) && /Path=\/auth/i.test(setCookie), setCookie);
  assert(!('refreshToken' in body), 'the refresh token is also in the JSON body');
  record({ name: `Set-Cookie: ${setCookie.replace(/erp_rt=[^;]+/, 'erp_rt=…')} (Secure follows COOKIE_SECURE, false in this local stack and by default)`, status: 'INFO' });
});
await check('the cookie alone opens no business route (only /auth/refresh reads it)', async () => {
  const res = await request('/clients', { cookie });
  assert(res.status === 401, `HTTP ${res.status}`);
});
await check('a cross-site form cannot use the refresh cookie (Origin is checked, or the body must be JSON)', async () => {
  // What a hostile page can send without a preflight: a form POST, cookie attached by the browser.
  const form = await fetch(`${API}/auth/refresh`, { method: 'POST', headers: { Cookie: cookie, Origin: 'https://evil.example', 'Content-Type': 'application/x-www-form-urlencoded' }, body: '' });
  const text = await form.text();
  record({ name: `cross-site form POST /auth/refresh with the cookie: HTTP ${form.status}, Access-Control-Allow-Origin: ${form.headers.get('access-control-allow-origin') ?? 'none'}`, status: 'INFO' });
  assert(form.status >= 400 || !form.headers.get('access-control-allow-origin'), `HTTP ${form.status} readable by the hostile origin: ${text.slice(0, 80)}`);
  assert(form.status >= 400, `the session was rotated by a cross-site form (HTTP ${form.status}); only SameSite=Lax stands between a hostile page and the cookie`);
});
await check('CORS: only WEB_ORIGIN is allowed, with credentials', async () => {
  const pre = (origin: string) => fetch(`${API}/clients`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
  const evil = await pre('https://evil.example');
  const nul = await pre('null');
  const good = await pre('http://localhost:3005');
  const sub = await pre('http://localhost:3005.evil.example');
  assert(!evil.headers.get('access-control-allow-origin') && !nul.headers.get('access-control-allow-origin') && !sub.headers.get('access-control-allow-origin'), `evil: ${evil.headers.get('access-control-allow-origin')}, null: ${nul.headers.get('access-control-allow-origin')}, look-alike: ${sub.headers.get('access-control-allow-origin')}`);
  assert(good.headers.get('access-control-allow-origin') === 'http://localhost:3005' && good.headers.get('access-control-allow-credentials') === 'true', `web origin: ${good.headers.get('access-control-allow-origin')}`);
});
await check('the API sends the helmet headers and no version banner', async () => {
  const res = await fetch(`${API}/health`);
  const h = (n: string): string | null => res.headers.get(n);
  const facts = `CSP ${h('content-security-policy')?.slice(0, 40)}, HSTS ${h('strict-transport-security')}, nosniff ${h('x-content-type-options')}, frame ${h('x-frame-options')}, referrer ${h('referrer-policy')}, x-powered-by ${h('x-powered-by')}`;
  record({ name: facts, status: 'INFO' });
  assert(!!h('content-security-policy') && !!h('strict-transport-security') && h('x-content-type-options') === 'nosniff' && !h('x-powered-by'), facts);
});

// =================================================================== super-admin
area('B3. Super-admin: TOTP and impersonation');
const admin = JSON.parse(readFileSync(fileURLToPath(new URL('../../.auth/audit02-admin.json', import.meta.url)), 'utf8')) as { email: string; password: string; secret: string };
const adminLogin = (body: Record<string, unknown>) => request<{ accessToken: string }>('/admin/auth/login', { method: 'POST', headers: ip(), body });
await check('the password alone does not open the super-admin area', async () => {
  const noCode = await adminLogin({ email: admin.email, password: admin.password });
  const wrong = await adminLogin({ email: admin.email, password: admin.password, code: '000000' });
  assert(noCode.status >= 400 && wrong.status === 401, `no code ${noCode.status}, wrong code ${wrong.status} ${code(wrong.raw)}`);
});
const codeNow = totp(admin.secret);
const first = await adminLogin({ email: admin.email, password: admin.password, code: codeNow });
await check('a TOTP code cannot be used twice', async () => {
  const again = await adminLogin({ email: admin.email, password: admin.password, code: codeNow });
  assert(first.status === 200, `first login ${first.status} ${first.raw.slice(0, 120)}`);
  assert(again.status !== 200, 'the same 6 digits opened a second session (RFC 6238 §5.2: a code must be accepted once)');
});
const adminTok = first.body.accessToken;
await check('a tenant token does not open /admin, and an admin token opens no tenant route', async () => {
  const a = await request('/admin/tenants', { token: c.session.token });
  const b = await request('/clients', { token: adminTok });
  assert(a.status === 401 && b.status === 401, `owner token on /admin/tenants ${a.status}, admin token on /clients ${b.status}`);
});
await check('impersonation is read-only, written to the platform journal, and ends with the admin session', async () => {
  const imp = await call<{ accessToken: string }>(`/admin/tenants/${c.tenantId}/impersonate`, { method: 'POST', token: adminTok });
  const t = imp.body.accessToken;
  const readOk = await request('/clients', { token: t });
  const write = await request('/clients', { method: 'POST', token: t, body: { code: 'IMP', name: 'Impersonated', type: 'PARTICULIER' } });
  const chat = await request('/assistant/chat', { method: 'POST', token: t, body: { message: 'bonjour' } });
  const logout = await request('/auth/logout', { method: 'POST', token: t });
  const [log] = await query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM platform_audit_logs WHERE "tenantId" = $1::uuid AND action = 'IMPERSONATION_REQUEST'`, [c.tenantId]);
  const [started] = await query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM platform_audit_logs WHERE "tenantId" = $1::uuid AND action ILIKE '%IMPERSONAT%' AND action <> 'IMPERSONATION_REQUEST'`, [c.tenantId]);
  await call('/admin/auth/logout', { method: 'POST', token: adminTok });
  const after = await request('/clients', { token: t });
  const facts = `read ${readOk.status}, write ${write.status} ${code(write.raw)}, chat ${chat.status}, logout ${logout.status}, requests journaled ${log?.n}, start journaled ${started?.n}, after the admin logged out ${after.status} ${code(after.raw)}`;
  record({ name: `impersonation: ${facts}`, status: 'INFO' });
  assert(readOk.status === 200 && write.status === 403 && chat.status === 403 && Number(log?.n) >= 1 && Number(started?.n) >= 1 && after.status === 401, facts);
});

writeSummary('auth');
await closeDb();
process.exit(0);
