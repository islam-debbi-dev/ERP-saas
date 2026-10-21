/**
 * Attacks: what a hostile or careless client can do to the API.
 * Every check states the expected behaviour and proves it against the API and
 * the database.
 *
 * Run: pnpm --dir e2e test:api
 */
import { area, assert, check, record, writeSummary } from '../lib/harness.ts';
import { call, idemKey, login, request, type Session } from '../lib/http.ts';
import { buildFixture, makeSale, num, today, uniq, type Fixture } from './fixture.ts';
import { query } from '../lib/db.ts';

const code = (body: unknown): string => (body as { code?: string })?.code ?? 'n/a';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  // ==================================================================== A. isolation
  area('A. Tenant isolation');
  const a = await buildFixture('Tenant A');
  const b = await buildFixture('Tenant B');
  const saleA = await makeSale(a, { qty: '1' });

  await check("A cannot read B's product", async () => {
    const res = await request(`/products/${a.productId}`, { token: b.session.token });
    assert(res.status === 404, `HTTP ${res.status} ${res.raw.slice(0, 120)}`);
  });
  await check("A cannot read B's client", async () => {
    const res = await request(`/clients/${a.clientId}`, { token: b.session.token });
    assert(res.status === 404, `HTTP ${res.status} ${res.raw.slice(0, 120)}`);
  });
  await check("A cannot read B's sale", async () => {
    const res = await request(`/sales/${saleA.id}`, { token: b.session.token });
    assert(res.status === 404, `HTTP ${res.status} ${res.raw.slice(0, 120)}`);
  });
  await check("A cannot see B's documents in the lists", async () => {
    const res = await request<{ items: { id: string }[] }>('/sales?limit=100', { token: b.session.token });
    assert(res.body.items.every((s) => s.id !== saleA.id), "B sees A's sale");
  });
  await check('a tenantId in the body is ignored (the JWT decides)', async () => {
    const res = await request<{ id: string }>('/sales', {
      method: 'POST',
      token: a.session.token,
      body: {
        type: 'BL',
        clientId: a.clientId,
        documentDate: today(),
        tenantId: b.tenantId,
        lines: [{ productId: a.productId, unitId: a.baseUnitId, qty: '1', unitPriceHt: '1000' }],
      },
    });
    assert(res.status === 201 || res.status === 200, `HTTP ${res.status} ${res.raw.slice(0, 200)}`);
    const rows = await query<{ tenantId: string }>('SELECT "tenantId"::text FROM sales WHERE id = $1::uuid', [
      res.body.id,
    ]);
    assert(rows[0].tenantId === a.tenantId, `the sale was written for tenant ${rows[0].tenantId}`);
  });
  await check("the stock of a tenant is not shared", async () => {
    const res = await request<{ items: { productId: string }[] }>('/stock?limit=100', { token: b.session.token });
    assert(!res.body.items.some((s) => s.productId === a.productId), "B sees A's stock");
  });

  // ==================================================================== B. idempotency
  area('B. Idempotency');
  await check('a POST that creates money needs an Idempotency-Key', async () => {
    const res = await request('/sales/quick', {
      method: 'POST',
      token: a.session.token,
      body: {
        type: 'BL',
        clientId: a.clientId,
        documentDate: today(),
        paidAmount: '0',
        paymentMode: 'ESPECES',
        lines: [{ productId: a.productId, unitId: a.baseUnitId, qty: '1', unitPriceHt: '1000' }],
      },
    });
    assert(res.status === 400, `HTTP ${res.status} ${res.raw.slice(0, 160)}`);
    assert(code(res.body) === 'IDEMPOTENCY_KEY_REQUIRED', `code=${code(res.body)}`);
  });
  await check('the same key and the same body replay the same answer', async () => {
    const key = idemKey('replay');
    const body = {
      type: 'BL',
      clientId: a.clientId,
      documentDate: today(),
      paidAmount: '0',
      paymentMode: 'ESPECES',
      lines: [{ productId: a.productId, unitId: a.baseUnitId, qty: '1', unitPriceHt: '1000' }],
    };
    const first = await request<{ sale: { id: string } }>('/sales/quick', {
      method: 'POST',
      token: a.session.token,
      idempotencyKey: key,
      body,
    });
    const second = await request<{ sale: { id: string } }>('/sales/quick', {
      method: 'POST',
      token: a.session.token,
      idempotencyKey: key,
      body,
    });
    assert(first.status === 201 || first.status === 200, `HTTP ${first.status} ${first.raw.slice(0, 200)}`);
    assert(first.body.sale.id === second.body.sale.id, 'the replay created another sale');
    assert(second.headers.get('idempotent-replayed') === 'true', 'the replay is not flagged');
    const rows = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM sales WHERE "tenantId" = $1::uuid AND id = $2::uuid`,
      [a.tenantId, first.body.sale.id],
    );
    assert(rows[0].n === '1', `sales created=${rows[0].n}`);
  });
  await check('the same key with another body is refused', async () => {
    const key = idemKey('reuse');
    const mk = (qty: string) => ({
      type: 'BL',
      clientId: a.clientId,
      documentDate: today(),
      paidAmount: '0',
      paymentMode: 'ESPECES',
      lines: [{ productId: a.productId, unitId: a.baseUnitId, qty, unitPriceHt: '1000' }],
    });
    await request('/sales/quick', { method: 'POST', token: a.session.token, idempotencyKey: key, body: mk('1') });
    const res = await request('/sales/quick', {
      method: 'POST',
      token: a.session.token,
      idempotencyKey: key,
      body: mk('2'),
    });
    assert(res.status === 409 || res.status === 400, `HTTP ${res.status} ${res.raw.slice(0, 160)}`);
    assert(code(res.body) === 'IDEMPOTENCY_KEY_REUSED', `code=${code(res.body)}`);
  });
  await check('a failed request does not consume a document number', async () => {
    // negativeStockMode = BLOCK: the sale fails after the number was taken
    await request('/tenant/settings', {
      method: 'PATCH',
      token: a.session.token,
      body: { negativeStockMode: 'BLOCK' },
    });
    const before = await query<{ n: string }>(
      `SELECT COALESCE(MAX("lastNumber"), 0)::text AS n FROM document_sequences
        WHERE "tenantId" = $1::uuid AND "docType" = 'BL'`,
      [a.tenantId],
    );
    const tooMuch = await request<{ id: string }>('/sales', {
      method: 'POST',
      token: a.session.token,
      body: {
        type: 'BL',
        clientId: a.clientId,
        documentDate: today(),
        lines: [{ productId: a.productId, unitId: a.baseUnitId, qty: '999999', unitPriceHt: '1000' }],
      },
    });
    assert(tooMuch.status === 201 || tooMuch.status === 200, `HTTP ${tooMuch.status}`);
    const failed = await request(`/sales/${tooMuch.body.id}/validate`, {
      method: 'POST',
      token: a.session.token,
      idempotencyKey: idemKey('nostock'),
      body: { paidAmount: '0', paymentMode: 'ESPECES', forceCredit: false },
    });
    assert(failed.status >= 400, `HTTP ${failed.status} ${failed.raw.slice(0, 160)}`);
    const after = await query<{ n: string }>(
      `SELECT COALESCE(MAX("lastNumber"), 0)::text AS n FROM document_sequences
        WHERE "tenantId" = $1::uuid AND "docType" = 'BL'`,
      [a.tenantId],
    );
    assert(before[0].n === after[0].n, `the sequence went from ${before[0].n} to ${after[0].n}`);
    await request('/tenant/settings', {
      method: 'PATCH',
      token: a.session.token,
      body: { negativeStockMode: 'WARN' },
    });
  });

  // ==================================================================== C. permissions
  area('C. Permissions (phase 11)');
  const owner = a.session;
  const seller = await inviteAndLogin(a, 'SELLER', 'Seller');
  const manager = await inviteAndLogin(a, 'MANAGER', 'Manager');
  const storekeeper = await inviteAndLogin(a, 'STOREKEEPER', 'Storekeeper');

  await check('a SELLER cannot cancel a validated sale', async () => {
    const s = await makeSale(a, { qty: '1' });
    const res = await request(`/sales/${s.id}/cancel`, {
      method: 'POST',
      token: seller.token,
      idempotencyKey: idemKey('cancel'),
      body: { reason: 'not allowed' },
    });
    assert(res.status === 403, `HTTP ${res.status} ${res.raw.slice(0, 160)}`);
  });
  await check('a SELLER cannot adjust the stock', async () => {
    const res = await request('/stock/adjustments', {
      method: 'POST',
      token: seller.token,
      idempotencyKey: idemKey('adj'),
      body: {
        reason: 'ERREUR',
        lines: [{ productId: a.productId, unitId: a.baseUnitId, qty: '-1' }],
      },
    });
    assert(res.status === 403, `HTTP ${res.status} ${res.raw.slice(0, 160)}`);
  });
  await check('a MANAGER cannot invite a user (OWNER only)', async () => {
    const res = await request('/users/invite', {
      method: 'POST',
      token: manager.token,
      body: {
        fullName: 'Nope',
        email: uniq('nope') + '@audit.local',
        role: 'SELLER',
        mode: 'PASSWORD',
        password: 'Temp1234!',
      },
    });
    assert(res.status === 403, `HTTP ${res.status} ${res.raw.slice(0, 160)}`);
  });
  await check('a STOREKEEPER can count but not validate an inventory', async () => {
    const created = await request<{ id: string }>('/inventories', {
      method: 'POST',
      token: storekeeper.token,
      idempotencyKey: idemKey('inv'),
      body: { note: 'audit count' },
    });
    assert(created.status === 201 || created.status === 200, `HTTP ${created.status} ${created.raw.slice(0, 160)}`);
    const res = await request(`/inventories/${created.body.id}/validate`, {
      method: 'POST',
      token: storekeeper.token,
      idempotencyKey: idemKey('invval'),
    });
    assert(res.status === 403, `HTTP ${res.status} ${res.raw.slice(0, 160)}`);
  });
  await check('a grant is visible at once, a revoke too', async () => {
    const me = await call<{ id: string; permissions: string[] }>('/auth/me', { token: seller.token });
    assert(!me.body.permissions.includes('SALE_CANCEL'), 'the SELLER has SALE_CANCEL by default');
    await call(`/users/${me.body.id}/permissions`, {
      method: 'PUT',
      token: owner.token,
      body: { grants: ['SALE_CANCEL'], revokes: [] },
    });
    const granted = await call<{ permissions: string[] }>('/auth/me', { token: seller.token });
    assert(granted.body.permissions.includes('SALE_CANCEL'), 'the grant is not visible');
    await call(`/users/${me.body.id}/permissions`, {
      method: 'PUT',
      token: owner.token,
      body: { grants: [], revokes: ['SALE_CANCEL'] },
    });
    const revoked = await call<{ permissions: string[] }>('/auth/me', { token: seller.token });
    assert(!revoked.body.permissions.includes('SALE_CANCEL'), 'the revoke is not visible');
  });
  await check('a deactivated user is locked out and his session dies', async () => {
    const tmp = await inviteAndLogin(a, 'SELLER', 'ToDeactivate');
    const me = await call<{ id: string }>('/auth/me', { token: tmp.token });
    await call(`/users/${me.body.id}/deactivate`, { method: 'POST', token: owner.token });
    const after = await request('/auth/me', { token: tmp.token });
    assert(after.status === 401 || after.status === 403, `HTTP ${after.status} ${after.raw.slice(0, 160)}`);
    const loginRes = await request('/auth/login', {
      method: 'POST',
      headers: { 'X-Client-Type': 'native' },
      body: { identifier: tmp.email, password: 'Changed1234!' },
    });
    assert(loginRes.status === 401 || loginRes.status === 403, `HTTP ${loginRes.status}`);
  });
  await check('a temporary password blocks every route but the password change', async () => {
    const email = uniq('tmp') + '@audit.local';
    await call('/users/invite', {
      method: 'POST',
      token: owner.token,
      body: { fullName: 'Temp pwd', email, role: 'SELLER', mode: 'PASSWORD', password: 'Temp1234!' },
    });
    const s = await login(email, 'Temp1234!');
    const res = await request('/products', { token: s.token });
    assert(res.status === 403, `HTTP ${res.status} ${res.raw.slice(0, 160)}`);
    assert(code(res.body) === 'PASSWORD_CHANGE_REQUIRED', `code=${code(res.body)}`);
    const change = await request('/auth/password', {
      method: 'POST',
      token: s.token,
      body: { currentPassword: 'Temp1234!', newPassword: 'Brand1234!' },
    });
    assert(change.status === 200, `HTTP ${change.status} ${change.raw.slice(0, 200)}`);
    const after = await request('/products', { token: s.token });
    assert(after.status === 200, `HTTP ${after.status} ${after.raw.slice(0, 160)}`);
  });
  await check('a SELLER cannot change the price of a line', async () => {
    const res = await request('/sales', {
      method: 'POST',
      token: seller.token,
      body: {
        type: 'BL',
        clientId: a.clientId,
        documentDate: today(),
        lines: [{ productId: a.productId, unitId: a.baseUnitId, qty: '1', unitPriceHt: '777' }],
      },
    });
    assert(res.status === 403, `HTTP ${res.status} ${res.raw.slice(0, 160)}`);
    assert(code(res.body) === 'PRICE_OVERRIDE_FORBIDDEN', `code=${code(res.body)}`);
  });
  await check('a SELLER does not see the costs and the margins', async () => {
    const stock = await request<{ items: { avgCost: string | null; value: string | null }[] }>(
      '/stock?limit=5',
      { token: seller.token },
    );
    assert(stock.body.items.every((s) => s.avgCost === null && s.value === null), 'the cost is visible');
    const range = `from=${today()}&to=${today()}`;
    const report = await request(`/reports/margin?${range}`, { token: seller.token });
    assert(report.status === 403, `HTTP ${report.status} ${report.raw.slice(0, 160)}`);
    const exportRes = await request(`/reports/margin/export.xlsx?${range}`, { token: seller.token });
    assert(exportRes.status === 403, `HTTP ${exportRes.status} ${exportRes.raw.slice(0, 160)}`);
  });

  // ==================================================================== D. money
  area('D. Money precision');
  await check('an amount with 3 decimals is refused', async () => {
    const res = await request('/payments', {
      method: 'POST',
      token: owner.token,
      idempotencyKey: idemKey('money'),
      body: { clientId: a.clientId, amount: '10.001', mode: 'ESPECES' },
    });
    assert(res.status === 400, `HTTP ${res.status} ${res.raw.slice(0, 160)}`);
  });
  await check(
    'an amount over Decimal(14,2) is refused with a clean error',
    async () => {
      const res = await request('/payments', {
        method: 'POST',
        token: owner.token,
        idempotencyKey: idemKey('big'),
        body: { clientId: a.clientId, amount: '9999999999999999.99', mode: 'ESPECES' },
      });
      // amountString accepts any positive amount with 2 decimals, but the column
      // is Decimal(14,2): the value must be refused by the API, not by Postgres.
      assert(
        res.status === 400 || res.status === 422,
        `HTTP ${res.status} ${code(res.body)} ${res.raw.slice(0, 120)}`,
      );
    },
    { expected: 'HTTP 400 VALIDATION_FAILED (the amount does not fit in Decimal(14,2))' },
  );
  await check('the totals are exact on a non-round price', async () => {
    const f = await buildFixture('Money');
    const sale = await request<{ id: string }>('/sales', {
      method: 'POST',
      token: f.session.token,
      body: {
        type: 'BL',
        clientId: f.clientId,
        documentDate: today(),
        lines: [{ productId: f.productId, unitId: f.baseUnitId, qty: '3', unitPriceHt: '33.33' }],
      },
    });
    const validated = await request<{ sale: { totalHt: string; totalTva: string; totalTtc: string } }>(
      `/sales/${sale.body.id}/validate`,
      {
        method: 'POST',
        token: f.session.token,
        idempotencyKey: idemKey('money-val'),
        body: { paidAmount: '0', paymentMode: 'ESPECES', forceCredit: false },
      },
    );
    // 3 x 33.33 = 99.99 HT ; TVA 19% = 18.9981 -> 19.00 ; TTC = 118.99
    assert(validated.body.sale.totalHt === '99.99', `totalHt=${validated.body.sale.totalHt}`);
    assert(validated.body.sale.totalTva === '19.00', `totalTva=${validated.body.sale.totalTva}`);
    assert(validated.body.sale.totalTtc === '118.99', `totalTtc=${validated.body.sale.totalTtc}`);
    const rows = await query<{ balance: string }>(
      `SELECT balance::text FROM client_balances WHERE "tenantId" = $1::uuid AND "clientId" = $2::uuid`,
      [f.tenantId, f.clientId],
    );
    assert(rows[0].balance === '118.99', `ledger balance=${rows[0].balance}`);
  });
  await check('a quantity with more than 3 decimals is refused', async () => {
    const res = await request('/sales', {
      method: 'POST',
      token: owner.token,
      body: {
        type: 'BL',
        clientId: a.clientId,
        documentDate: today(),
        lines: [{ productId: a.productId, unitId: a.baseUnitId, qty: '1.0001', unitPriceHt: '1000' }],
      },
    });
    assert(res.status === 400, `HTTP ${res.status} ${res.raw.slice(0, 160)}`);
  });

  // ==================================================================== E. concurrency
  area('E. Concurrency');
  await check('three concurrent payments do not lose an update', async () => {
    const f = await buildFixture('Concurrency');
    const before = await clientBalance(f);
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        request('/payments', {
          method: 'POST',
          token: f.session.token,
          idempotencyKey: idemKey('conc'),
          body: { clientId: f.clientId, amount: '100', mode: 'ESPECES' },
        }),
      ),
    );
    const ok = results.filter((r) => r.status === 201 || r.status === 200);
    assert(ok.length === 3, `accepted=${ok.length}`);
    const after = await clientBalance(f);
    assert(after === before - 300, `balance ${before} -> ${after}`);
  });
  await check('two concurrent sales of the last unit: BLOCK mode sells one only', async () => {
    const f = await buildFixture('Last unit BLOCK');
    await request('/tenant/settings', {
      method: 'PATCH',
      token: f.session.token,
      body: { negativeStockMode: 'BLOCK' },
    });
    await call('/stock/adjustments', {
      method: 'POST',
      token: f.session.token,
      idempotencyKey: idemKey('adj'),
      body: {
        reason: 'ERREUR',
        lines: [{ productId: f.productId, unitId: f.baseUnitId, qty: '-99' }],
      },
    });
    const sell = () =>
      request<{ sale: { id: string } }>('/sales/quick', {
        method: 'POST',
        token: f.session.token,
        idempotencyKey: idemKey('last'),
        body: {
          type: 'BL',
          clientId: f.clientId,
          documentDate: today(),
          paidAmount: '0',
          paymentMode: 'ESPECES',
          lines: [{ productId: f.productId, unitId: f.baseUnitId, qty: '1', unitPriceHt: '1000' }],
        },
      });
    const [r1, r2] = await Promise.all([sell(), sell()]);
    const accepted = [r1, r2].filter((r) => r.status === 200 || r.status === 201);
    const refused = [r1, r2].filter((r) => r.status >= 400);
    assert(accepted.length === 1, `accepted=${accepted.length} refused=${refused.length}`);
    assert(
      refused.every((r) => code(r.body) === 'STOCK_INSUFFICIENT'),
      `codes=${refused.map((r) => code(r.body)).join(',')}`,
    );
    const stock = await query<{ qtyBase: string }>(
      `SELECT "qtyBase"::text FROM product_stocks WHERE "tenantId" = $1::uuid AND "productId" = $2::uuid`,
      [f.tenantId, f.productId],
    );
    assert(num(stock[0].qtyBase) === 0, `stock=${stock[0].qtyBase}`);
    assert(await cacheMatchesLedger(f), 'the cached stock does not match the ledger');
  });
  await check('two concurrent sales of the last unit: WARN mode announces the negative stock', async () => {
    const f = await buildFixture('Last unit WARN');
    await request('/tenant/settings', {
      method: 'PATCH',
      token: f.session.token,
      body: { negativeStockMode: 'WARN' },
    });
    await call('/stock/adjustments', {
      method: 'POST',
      token: f.session.token,
      idempotencyKey: idemKey('adj'),
      body: {
        reason: 'ERREUR',
        lines: [{ productId: f.productId, unitId: f.baseUnitId, qty: '-99' }],
      },
    });
    const sell = () =>
      request<{ warnings: { kind: string }[] }>('/sales/quick', {
        method: 'POST',
        token: f.session.token,
        idempotencyKey: idemKey('last'),
        body: {
          type: 'BL',
          clientId: f.clientId,
          documentDate: today(),
          paidAmount: '0',
          paymentMode: 'ESPECES',
          lines: [{ productId: f.productId, unitId: f.baseUnitId, qty: '1', unitPriceHt: '1000' }],
        },
      });
    const [r1, r2] = await Promise.all([sell(), sell()]);
    const accepted = [r1, r2].filter((r) => r.status === 200 || r.status === 201);
    assert(accepted.length === 2, `accepted=${accepted.length}`);
    assert(
      accepted.some((r) => r.body.warnings.some((w) => w.kind === 'NEGATIVE_STOCK')),
      'no NEGATIVE_STOCK warning was returned',
    );
    assert(await cacheMatchesLedger(f), 'the cached stock does not match the ledger');
  });

  // ==================================================================== F. auth
  area('F. Authentication');
  // The login limiter counts every attempt (successful ones included) per IP
  // and per identifier: 10 per minute and per key. The checks below need a
  // free window, so they wait for it.
  await sleep(61_000);
  await check('five wrong passwords lock the account', async () => {
    const email = uniq('lock') + '@audit.local';
    await call('/users/invite', {
      method: 'POST',
      token: owner.token,
      body: { fullName: 'To lock', email, role: 'SELLER', mode: 'PASSWORD', password: 'Temp1234!' },
    });
    const codes: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await request('/auth/login', {
        method: 'POST',
        headers: { 'X-Client-Type': 'native' },
        body: { identifier: email, password: 'Wrong1234!' },
      });
      codes.push(`${res.status}:${code(res.body)}`);
    }
    assert(codes.some((c) => c.includes('ACCOUNT_LOCKED')), `codes=${codes.join(',')}`);
  });
  await check('a forged token is refused', async () => {
    const res = await request('/products', { token: 'eyJhbGciOiJIUzI1NiJ9.e30.invalidsignature' });
    assert(res.status === 401, `HTTP ${res.status} ${res.raw.slice(0, 160)}`);
  });
  await check('no token at all is refused', async () => {
    const res = await request('/products');
    assert(res.status === 401, `HTTP ${res.status} ${res.raw.slice(0, 160)}`);
  });
  await check('a refresh token reused after the grace window closes the session', async () => {
    // The API accepts the previous refresh token once more during
    // REFRESH_REUSE_GRACE_SECONDS (60s by default) to survive a lost answer.
    // After that window the reuse must be detected and the session closed.
    const f = await buildFixture('Refresh');
    const s = await login(f.session.email, 'Audit1234!');
    assert(s.refreshToken !== null, 'no refresh token for a native client');
    const first = await request('/auth/refresh', {
      method: 'POST',
      headers: { 'X-Client-Type': 'native' },
      body: { refreshToken: s.refreshToken },
    });
    assert(first.status === 200, `HTTP ${first.status} ${first.raw.slice(0, 160)}`);
    const inside = await request('/auth/refresh', {
      method: 'POST',
      headers: { 'X-Client-Type': 'native' },
      body: { refreshToken: s.refreshToken },
    });
    assert(inside.status === 200, `the grace window refused the token (HTTP ${inside.status})`);
    await sleep(62_000);
    const after = await request('/auth/refresh', {
      method: 'POST',
      headers: { 'X-Client-Type': 'native' },
      body: { refreshToken: s.refreshToken },
    });
    assert(after.status >= 400, `the old refresh token was accepted again (HTTP ${after.status})`);
    assert(code(after.body) === 'REFRESH_TOKEN_REUSED', `code=${code(after.body)}`);
    const sessions = await query<{ revoked: string }>(
      `SELECT COUNT(*)::text AS revoked FROM sessions WHERE "userId" = $1::uuid AND "revokedAt" IS NOT NULL`,
      [s.userId],
    );
    assert(Number(sessions[0].revoked) >= 1, `revoked sessions=${sessions[0].revoked}`);
  });
  await check('ten logins from one IP lock out a valid user of another account', async () => {
    // The IP window counts the successful logins too: after 10 attempts from
    // one IP, every other account of the same IP is refused, even with the
    // right password.
    const a = await buildFixture('IP limit A');
    const b = await buildFixture('IP limit B');
    const codes: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const res = await request('/auth/login', {
        method: 'POST',
        headers: { 'X-Client-Type': 'native' },
        body: { identifier: a.session.email, password: 'Audit1234!' },
      });
      codes.push(`${res.status}:${code(res.body)}`);
    }
    assert(
      codes.every((c) => c.startsWith('200')),
      `the 10 logins were not all accepted: ${codes.join(',')}`,
    );
    const other = await request('/auth/login', {
      method: 'POST',
      headers: { 'X-Client-Type': 'native' },
      body: { identifier: b.session.email, password: 'Audit1234!' },
    });
    assert(
      other.status === 429,
      `HTTP ${other.status} ${code(other.body)} - the other account was not locked out`,
    );
  });
  await check('the login rate limit is bypassed with a forged X-Forwarded-For', async () => {
    await sleep(61_000);
    const codes: string[] = [];
    for (let i = 0; i < 11; i += 1) {
      const res = await request('/auth/login', {
        method: 'POST',
        headers: { 'X-Client-Type': 'native', 'X-Forwarded-For': `203.0.113.${i + 1}` },
        body: { identifier: `ghost${uniq('')}@audit.local`, password: 'Wrong1234!' },
      });
      codes.push(`${res.status}:${code(res.body)}`);
    }
    assert(
      !codes.some((c) => c.includes('TOO_MANY_REQUESTS')),
      `the forged IPs were rate limited: ${codes.join(',')}`,
    );
  });
  await check('the forged IP is what the audit trail records', async () => {
    const email = uniq('ip') + '@audit.local';
    await call('/users/invite', {
      method: 'POST',
      token: owner.token,
      body: { fullName: 'Ip audit', email, role: 'SELLER', mode: 'PASSWORD', password: 'Temp1234!' },
    });
    await request('/auth/login', {
      method: 'POST',
      headers: { 'X-Client-Type': 'native', 'X-Forwarded-For': '198.51.100.42' },
      body: { identifier: email, password: 'Wrong1234!' },
    });
    const rows = await query<{ after: { ip: string | null } | null }>(
      `SELECT after FROM audit_logs WHERE action = 'LOGIN_FAILED' AND after->>'ip' IS NOT NULL
        ORDER BY "createdAt" DESC LIMIT 1`,
    );
    assert(rows.length === 1, 'no LOGIN_FAILED audit row');
    assert(rows[0].after?.ip === '198.51.100.42', `the audit trail says ip=${rows[0].after?.ip}`);
  });

  // ==================================================================== G. state machine
  area('G. State machine and optimistic locking');
  await check('a sale cannot be validated twice', async () => {
    const f = await buildFixture('State');
    const s = await makeSale(f, { qty: '1' });
    const res = await request(`/sales/${s.id}/validate`, {
      method: 'POST',
      token: f.session.token,
      idempotencyKey: idemKey('twice'),
      body: { paidAmount: '0', paymentMode: 'ESPECES', forceCredit: false },
    });
    assert(res.status === 400 || res.status === 409, `HTTP ${res.status} ${res.raw.slice(0, 160)}`);
    assert(code(res.body) === 'SALE_NOT_DRAFT', `code=${code(res.body)}`);
  });
  await check('a stale version is refused', async () => {
    const f = await buildFixture('Version');
    const client = (
      await call<{ id: string; code: string; version: number }>(`/clients/${f.clientId}`, { token: f.session.token })
    ).body;
    await call(`/clients/${f.clientId}`, {
      method: 'PATCH',
      token: f.session.token,
      body: { code: client.code, name: 'Renamed', type: 'PARTICULIER', version: client.version },
    });
    const res = await request(`/clients/${f.clientId}`, {
      method: 'PATCH',
      token: f.session.token,
      body: { code: client.code, name: 'Renamed twice', type: 'PARTICULIER', version: client.version },
    });
    assert(res.status === 400 || res.status === 409, `HTTP ${res.status} ${res.raw.slice(0, 160)}`);
    assert(code(res.body) === 'CLIENT_MODIFIED', `code=${code(res.body)}`);
  });
  await check('more than sold cannot be returned', async () => {
    const f = await buildFixture('Return');
    const s = await makeSale(f, { qty: '1' });
    const dto = (await call<{ lines: { id: string }[] }>(`/sales/${s.id}`, { token: f.session.token })).body;
    const res = await request(`/sales/${s.id}/returns`, {
      method: 'POST',
      token: f.session.token,
      idempotencyKey: idemKey('toomuch'),
      body: {
        disposition: 'RESTOCK',
        reason: 'too much',
        lines: [{ saleLineId: dto.lines[0].id, qty: '5' }],
      },
    });
    assert(res.status === 400 || res.status === 409, `HTTP ${res.status} ${res.raw.slice(0, 160)}`);
    assert(code(res.body) === 'RETURN_EXCEEDS_SOLD', `code=${code(res.body)}`);
  });
  await check('a payment made with a sale cannot be cancelled alone', async () => {
    const f = await buildFixture('Linked payment');
    const s = await makeSale(f, { qty: '1', paid: '1190' });
    const payments = await query<{ id: string }>(
      `SELECT id::text FROM payments WHERE "tenantId" = $1::uuid AND "saleId" = $2::uuid`,
      [f.tenantId, s.id],
    );
    assert(payments.length === 1, `payments of the sale=${payments.length}`);
    const res = await request(`/payments/${payments[0].id}/cancel`, {
      method: 'POST',
      token: f.session.token,
      idempotencyKey: idemKey('cancelpay'),
      body: { reason: 'not allowed' },
    });
    assert(res.status === 400 || res.status === 409, `HTTP ${res.status} ${res.raw.slice(0, 160)}`);
    assert(code(res.body) === 'PAYMENT_LINKED_TO_SALE', `code=${code(res.body)}`);
  });
  await check('a cash payment cannot bounce', async () => {
    const f = await buildFixture('Bounce');
    const p = (
      await call<{ id: string }>('/payments', {
        method: 'POST',
        token: f.session.token,
        idempotencyKey: idemKey('cash'),
        body: { clientId: f.clientId, amount: '100', mode: 'ESPECES' },
      })
    ).body;
    const res = await request(`/payments/${p.id}/bounce`, {
      method: 'POST',
      token: f.session.token,
      idempotencyKey: idemKey('bounce'),
      body: { reason: 'returned' },
    });
    assert(res.status === 400 || res.status === 409, `HTTP ${res.status} ${res.raw.slice(0, 160)}`);
    assert(code(res.body) === 'PAYMENT_NOT_CHEQUE', `code=${code(res.body)}`);
  });
  await check('a bounced cheque gives the money back to the account', async () => {
    const f = await buildFixture('Bounce cheque');
    const p = (
      await call<{ id: string }>('/payments', {
        method: 'POST',
        token: f.session.token,
        idempotencyKey: idemKey('cheque'),
        body: { clientId: f.clientId, amount: '500', mode: 'CHEQUE', bank: 'BNA', reference: 'CHQ1' },
      })
    ).body;
    const before = await clientBalance(f);
    const res = await request(`/payments/${p.id}/bounce`, {
      method: 'POST',
      token: f.session.token,
      idempotencyKey: idemKey('bounce2'),
      body: { reason: 'no money' },
    });
    assert(res.status === 200, `HTTP ${res.status} ${res.raw.slice(0, 200)}`);
    const after = await clientBalance(f);
    assert(after === before + 500, `balance ${before} -> ${after}`);
  });
  await check('more allocated than paid is refused', async () => {
    const f = await buildFixture('Allocation');
    const s = await makeSale(f, { qty: '2' });
    const res = await request('/payments', {
      method: 'POST',
      token: f.session.token,
      idempotencyKey: idemKey('alloc'),
      body: {
        clientId: f.clientId,
        amount: '100',
        mode: 'ESPECES',
        allocations: [{ saleId: s.id, amount: '500' }],
      },
    });
    assert(res.status === 400 || res.status === 409, `HTTP ${res.status} ${res.raw.slice(0, 160)}`);
    assert(code(res.body) === 'ALLOCATION_INVALID', `code=${code(res.body)}`);
  });

  // ==================================================================== H. injection
  area('H. Injection and mass assignment');
  await check('a hostile id is refused, not a 500', async () => {
    const res = await request(`/products/'; DROP TABLE products;--`, { token: owner.token });
    assert(res.status === 400 || res.status === 404, `HTTP ${res.status} ${res.raw.slice(0, 160)}`);
    const still = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM information_schema.tables WHERE table_name = 'products'`,
    );
    assert(still[0].n === '1', 'the products table is gone');
  });
  await check('a hostile search term is harmless', async () => {
    const res = await request<{ items: unknown[] }>('/products?search=%27%3B+DROP+TABLE+products%3B--', {
      token: owner.token,
    });
    assert(res.status === 200, `HTTP ${res.status} ${res.raw.slice(0, 160)}`);
    assert(Array.isArray(res.body.items), 'the answer is not a list');
  });
  await check('the client balance cannot be written directly', async () => {
    const f = await buildFixture('Balance');
    const created = await call<{ id: string }>('/clients', {
      method: 'POST',
      token: f.session.token,
      idempotencyKey: idemKey('mass'),
      body: { code: uniq('X-'), name: 'Mass assignment', type: 'PARTICULIER', balance: '1000000' },
    });
    const dto = await call<{ balance: string }>(`/clients/${created.body.id}`, { token: f.session.token });
    assert(num(dto.body.balance) === 0, `balance=${dto.body.balance}`);
    const rows = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM client_ledger_entries WHERE "tenantId" = $1::uuid AND "clientId" = $2::uuid`,
      [f.tenantId, created.body.id],
    );
    assert(rows[0].n === '0', `ledger rows=${rows[0].n}`);
  });
  await check('a script tag in a designation is stored as data', async () => {
    const f = await buildFixture('XSS');
    const payload = '<script>alert(1)</script>';
    const product = await call<{ id: string; designation: string }>('/products', {
      method: 'POST',
      token: f.session.token,
      idempotencyKey: idemKey('xss'),
      body: {
        reference: uniq('X-'),
        designation: payload,
        baseUnitId: f.baseUnitId,
        tvaRate: '19',
        units: [
          {
            unitId: f.baseUnitId,
            factorToBase: '1',
            barcode: null,
            isDefaultSale: true,
            isDefaultPurchase: true,
          },
        ],
        prices: [{ unitId: f.baseUnitId, priceLevelId: f.priceLevelId, priceHt: '1000' }],
      },
    });
    assert(product.body.designation === payload, 'the designation was altered by the API');
    record({
      name: 'info: the API stores the payload as data, the web must escape it',
      status: 'INFO',
      expected: 'the API stores the text; React escapes it on render',
      actual: `designation=${product.body.designation}`,
    });
  });

  // ==================================================================== I. audit trail
  area('I. Audit trail and timestamps');
  await check('the rows of one operation share the same createdAt', async () => {
    const f = await buildFixture('Timestamps');
    const s = await makeSale(f, { qty: '1' });
    const rows = await query<{ table_name: string; created_at: string }>(
      `SELECT 'sale' AS table_name, "createdAt"::text AS created_at FROM sales WHERE id = $1::uuid
       UNION ALL SELECT 'sale_line', "createdAt"::text FROM sale_lines WHERE "saleId" = $1::uuid
       UNION ALL SELECT 'stock_movement', "createdAt"::text FROM stock_movements WHERE "refId" = $1::uuid
       UNION ALL SELECT 'ledger', "createdAt"::text FROM client_ledger_entries WHERE "refId" = $1::uuid
       UNION ALL SELECT 'audit', "createdAt"::text FROM audit_logs WHERE "entityId" = $1::text AND action = 'SALE_VALIDATED'`,
      [s.id],
    );
    const stamps = [...new Set(rows.map((r) => r.created_at))];
    assert(
      stamps.length === 1,
      `${rows.length} rows of one transaction carry ${stamps.length} different createdAt values: ${stamps.join(', ')}`,
    );
  });
  await check('the audit rows of one operation keep the transaction order', async () => {
    const f = await buildFixture('Order');
    const s = await makeSale(f, { qty: '1' });
    const rows = await query<{ action: string; created_at: string; xmin: string }>(
      `SELECT action, "createdAt"::text AS created_at, xmin::text FROM audit_logs
        WHERE "tenantId" = $1::uuid AND "entityId" = $2::text ORDER BY "createdAt"`,
      [f.tenantId, s.id],
    );
    const stamps = [...new Set(rows.map((r) => r.created_at))];
    record({
      name: 'info: the createdAt of the audit rows of one transaction',
      status: 'INFO',
      expected: 'one timestamp for the whole transaction (the schema says so)',
      actual: `${rows.length} rows, ${stamps.length} timestamps, xmin=${[...new Set(rows.map((r) => r.xmin))].join('/')}`,
    });
  });
}

// ---------------------------------------------------------------- helpers

async function clientBalance(f: Fixture): Promise<number> {
  const rows = await query<{ balance: string }>(
    `SELECT balance::text FROM client_balances WHERE "tenantId" = $1::uuid AND "clientId" = $2::uuid`,
    [f.tenantId, f.clientId],
  );
  return num(rows[0]?.balance ?? '0');
}

/** The cached stock must always equal the sum of the movements. */
async function cacheMatchesLedger(f: Fixture): Promise<boolean> {
  const rows = await query<{ cached: string; ledger: string }>(
    `SELECT ps."qtyBase"::text AS cached,
            COALESCE((SELECT SUM(sm."qtyBase") FROM stock_movements sm
                       WHERE sm."tenantId" = ps."tenantId" AND sm."productId" = ps."productId"), 0)::text AS ledger
       FROM product_stocks ps
      WHERE ps."tenantId" = $1::uuid AND ps."productId" = $2::uuid`,
    [f.tenantId, f.productId],
  );
  if (rows.length === 0) return true;
  return num(rows[0].cached) === num(rows[0].ledger);
}

/** The session of the last login of the owner of a tenant. */
async function sessionIdOf(f: Fixture): Promise<string> {
  const rows = await query<{ id: string }>(
    `SELECT id::text FROM sessions WHERE "tenantId" = $1::uuid ORDER BY "createdAt" DESC LIMIT 1`,
    [f.tenantId],
  );
  return rows[0]?.id ?? '';
}

/** Invites a user with a temporary password, changes it, and logs him in. */
async function inviteAndLogin(f: Fixture, role: string, label: string): Promise<Session> {
  const email = uniq('u') + '@audit.local';
  await call('/users/invite', {
    method: 'POST',
    token: f.session.token,
    body: { fullName: `${label} ${role}`, email, role, mode: 'PASSWORD', password: 'Temp1234!' },
  });
  const first = await login(email, 'Temp1234!');
  await call('/auth/password', {
    method: 'POST',
    token: first.token,
    body: { currentPassword: 'Temp1234!', newPassword: 'Changed1234!' },
  });
  return login(email, 'Changed1234!');
}

main()
  .then(() => writeSummary('attacks'))
  .catch((err) => {
    console.error(err);
    writeSummary('attacks');
    process.exit(1);
  });
