import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import {
  type AuthResponse,
  type ClientDto,
  type ClientPage,
  type ClientReconcileReport,
  type ClientStatementDto,
  type DebtorDto,
  ErrorCode,
  money,
} from '@erp/shared';
import { ClientAccountService } from '../src/clients/client-account.service';
import {
  asTenant,
  bearer,
  createTestApp,
  registerTenant,
  type RegisteredTenant,
  type TestApp,
  uniqueEmail,
} from './helpers';

describe('clients', () => {
  let t: TestApp;
  let a: RegisteredTenant;
  let b: RegisteredTenant;
  let account: ClientAccountService;
  let codeSeq = 0;

  const as = (who: RegisteredTenant) => ({
    get: (url: string) =>
      t
        .http()
        .get(url)
        .set(...bearer(who.auth.accessToken)),
    post: (url: string, body: object = {}, key: string | null = randomUUID()) => {
      const req = t
        .http()
        .post(url)
        .set(...bearer(who.auth.accessToken));
      if (key) req.set('Idempotency-Key', key);
      return req.send(body);
    },
    patch: (url: string, body: object) =>
      t
        .http()
        .patch(url)
        .set(...bearer(who.auth.accessToken))
        .send(body),
    delete: (url: string) =>
      t
        .http()
        .delete(url)
        .set(...bearer(who.auth.accessToken)),
  });

  const newClient = async (who: RegisteredTenant, extra: object = {}) =>
    (
      await as(who)
        .post('/clients', { code: `C${++codeSeq}`, name: `Client ${codeSeq}`, ...extra }, null)
        .expect(201)
    ).body as ClientDto;

  const fetchClient = async (who: RegisteredTenant, id: string) =>
    (await as(who).get(`/clients/${id}`).expect(200)).body as ClientDto;

  /** Posts straight through the service, as sales and versements will. */
  const post = (who: RegisteredTenant, clientId: string, amount: string, createdAt?: Date) =>
    asTenant(who.tenantId, () =>
      t.prisma.db.$transaction(async (tx) => {
        const main = await tx.warehouse.findFirstOrThrow({ where: { isDefault: true } });
        return account.post(tx, [
          {
            clientId,
            type: 'ADJUSTMENT',
            amount,
            label: 'test',
            reason: 'test',
            createdAt,
            warehouseId: main.id,
          },
        ]);
      }),
    );

  const loginAs = async (who: RegisteredTenant, role: 'SELLER' | 'MANAGER') => {
    const email = uniqueEmail(role.toLowerCase());
    await asTenant(who.tenantId, async () =>
      t.prisma.db.user.create({
        data: {
          tenantId: who.tenantId,
          email,
          passwordHash: await argon2.hash('Password123!'),
          fullName: role,
          role,
        },
      }),
    );
    const login = await t
      .http()
      .post('/auth/login')
      .send({ email, password: 'Password123!' })
      .expect(200);
    return { ...who, auth: login.body as AuthResponse & { refreshToken: string } };
  };

  beforeAll(async () => {
    t = await createTestApp();
    account = t.app.get(ClientAccountService);
    a = await registerTenant(t, 'Clients A');
    b = await registerTenant(t, 'Clients B');
  });
  afterAll(() => t.close());

  it('creates a client with a plafond and no balance yet', async () => {
    const c = await newClient(a, {
      name: 'Épicerie Benali',
      phone: '0550 12 34 56',
      creditLimit: '50 000',
    });
    expect(c).toMatchObject({
      creditLimit: '50000.00',
      balance: '0.00',
      hasOpening: false,
      overLimit: false,
      version: 1,
    });
  });

  it('opening balance is accepted once, and replays return the first response', async () => {
    const c = await newClient(a);
    const key = randomUUID();
    const first = await as(a)
      .post(`/clients/${c.id}/opening-balance`, { amount: '32000', note: 'reprise cahier' }, key)
      .expect(201);
    const replay = await as(a)
      .post(`/clients/${c.id}/opening-balance`, { amount: '32000', note: 'reprise cahier' }, key)
      .expect(201);
    expect(replay.body).toEqual(first.body);
    expect((first.body as ClientDto).balance).toBe('32000.00');
    expect((first.body as ClientDto).hasOpening).toBe(true);
    const again = await as(a)
      .post(`/clients/${c.id}/opening-balance`, { amount: '100' })
      .expect(409);
    expect(again.body).toMatchObject({ code: ErrorCode.CLIENT_OPENING_ALREADY_SET });
    const count = await asTenant(a.tenantId, () =>
      t.prisma.db.clientLedgerEntry.count({ where: { clientId: c.id } }),
    );
    expect(count).toBe(1);
  });

  it('a negative opening balance is credit in the client’s favour; zero is refused', async () => {
    const c = await newClient(a);
    await as(a).post(`/clients/${c.id}/opening-balance`, { amount: '0' }).expect(400);
    const res = await as(a)
      .post(`/clients/${c.id}/opening-balance`, { amount: '-1500.50' })
      .expect(201);
    expect((res.body as ClientDto).balance).toBe('-1500.50');
  });

  it('adjustments need a reason and a manager', async () => {
    const c = await newClient(a);
    await as(a).post(`/clients/${c.id}/adjustments`, { amount: '-2000' }).expect(400);
    const seller = await loginAs(a, 'SELLER');
    await as(seller)
      .post(`/clients/${c.id}/adjustments`, { amount: '-2000', reason: 'remise accordée' })
      .expect(403);
    await as(seller).post(`/clients/${c.id}/opening-balance`, { amount: '100' }).expect(403);
    const res = await as(a)
      .post(`/clients/${c.id}/adjustments`, { amount: '-2000', reason: 'remise accordée' })
      .expect(201);
    expect((res.body as ClientDto).balance).toBe('-2000.00');
  });

  it('sellers create and edit clients but cannot touch the plafond', async () => {
    const seller = await loginAs(a, 'SELLER');
    const denied = await as(seller)
      .post('/clients', { code: `S${++codeSeq}`, name: 'Vendeur', creditLimit: '1000' }, null)
      .expect(403);
    expect(denied.body).toMatchObject({ details: { field: 'creditLimit' } });
    const c = await newClient(a, { creditLimit: '1000' });
    const { id, balance, hasOpening, overLimit, archivedAt, ...fields } = c;
    void [id, balance, hasOpening, overLimit, archivedAt];
    await as(seller)
      .patch(`/clients/${c.id}`, { ...fields, creditLimit: '5000' })
      .expect(403);
    const ok = await as(seller)
      .patch(`/clients/${c.id}`, { ...fields, creditLimit: '1 000,00', phone: '0661' })
      .expect(200);
    expect(ok.body).toMatchObject({ phone: '0661', creditLimit: '1000.00', version: 2 });
  });

  it('duplicate code and stale version are 409', async () => {
    const c = await newClient(a);
    const dup = await as(a).post('/clients', { code: c.code, name: 'Autre' }, null).expect(409);
    expect(dup.body).toMatchObject({ code: ErrorCode.CLIENT_CODE_TAKEN });
    // Same code in another tenant is fine.
    await as(b).post('/clients', { code: c.code, name: 'Autre' }, null).expect(201);

    const { id, balance, hasOpening, overLimit, archivedAt, ...fields } = c;
    void [id, balance, hasOpening, overLimit, archivedAt];
    await as(a)
      .patch(`/clients/${c.id}`, { ...fields, name: 'Premier' })
      .expect(200);
    const stale = await as(a)
      .patch(`/clients/${c.id}`, { ...fields, name: 'Second' })
      .expect(409);
    expect(stale.body).toMatchObject({ code: ErrorCode.CLIENT_MODIFIED });
    expect((await fetchClient(a, c.id)).name).toBe('Premier');
  });

  it('20 parallel posts leave the cached balance equal to the ledger', async () => {
    const c = await newClient(a);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => post(a, c.id, i % 2 === 0 ? '1000.10' : '-250.05')),
    );
    // 10 × 1000.10 − 10 × 250.05
    expect((await fetchClient(a, c.id)).balance).toBe('7500.50');
    const ledger = await asTenant(a.tenantId, () =>
      t.prisma.db.clientLedgerEntry.aggregate({
        where: { clientId: c.id },
        _sum: { amount: true },
        _count: true,
      }),
    );
    expect(ledger._count).toBe(20);
    expect(ledger._sum.amount?.toString()).toBe('7500.5');
  });

  it('statement: opening before the range, running balance and closing, in Algiers days', async () => {
    const c = await newClient(a);
    await post(a, c.id, '10000', new Date('2026-03-15T10:00:00Z'));
    // 2026-03-31 23:30 UTC is already April 1st in Algiers (UTC+1).
    await post(a, c.id, '5000', new Date('2026-03-31T23:30:00Z'));
    await post(a, c.id, '-3000', new Date('2026-04-10T09:00:00Z'));
    // 2026-04-30 23:30 UTC is May 1st in Algiers: outside April.
    await post(a, c.id, '700', new Date('2026-04-30T23:30:00Z'));

    const s = (
      await as(a).get(`/clients/${c.id}/statement?from=2026-04-01&to=2026-04-30`).expect(200)
    ).body as ClientStatementDto;
    expect(s.openingBalance).toBe('10000.00');
    expect(s.entries.map((e) => [e.amount, e.runningBalance])).toEqual([
      ['5000.00', '15000.00'],
      ['-3000.00', '12000.00'],
    ]);
    expect(s).toMatchObject({
      totalDebit: '5000.00',
      totalCredit: '3000.00',
      closingBalance: '12000.00',
    });

    const may = (
      await as(a).get(`/clients/${c.id}/statement?from=2026-05-01&to=2026-05-01`).expect(200)
    ).body as ClientStatementDto;
    expect(may.openingBalance).toBe('12000.00');
    expect(may.entries.map((e) => e.runningBalance)).toEqual(['12700.00']);

    await as(a).get(`/clients/${c.id}/statement?from=2026-05-01&to=2026-04-01`).expect(400);
  });

  it('checkCreditLimit: no limit is OK, above the plafond follows the tenant mode', async () => {
    const check = (clientId: string, extra: string) =>
      asTenant(a.tenantId, () =>
        t.prisma.db.$transaction((tx) => account.checkCreditLimit(tx, clientId, extra)),
      );
    const free = await newClient(a);
    expect((await check(free.id, '999999')).status).toBe('OK');

    const c = await newClient(a, { creditLimit: '50000' });
    await post(a, c.id, '32000');
    expect(await check(c.id, '18000')).toEqual({
      status: 'OK',
      balance: '32000.00',
      limit: '50000.00',
      projected: '50000.00',
    });

    await as(a).patch('/tenant/settings', { creditLimitMode: 'WARN' }).expect(200);
    expect((await check(c.id, '18000.01')).status).toBe('WARN');
    await as(a).patch('/tenant/settings', { creditLimitMode: 'BLOCK' }).expect(200);
    expect((await check(c.id, '18000.01')).status).toBe('BLOCK');
  });

  it('filters by search, debt and over-limit; debtors are sorted by balance', async () => {
    const tag = randomUUID().slice(0, 6);
    const owes = await newClient(a, { name: `Filtre ${tag} doit`, phone: `07${tag}` });
    const over = await newClient(a, { name: `Filtre ${tag} dépasse`, creditLimit: '100' });
    const credit = await newClient(a, { name: `Filtre ${tag} crédit` });
    await post(a, owes.id, '900000');
    await post(a, over.id, '150');
    await post(a, credit.id, '-50');

    const list = async (q: string) =>
      (
        (
          await as(a)
            .get(`/clients?search=${encodeURIComponent(tag)}${q}`)
            .expect(200)
        ).body as ClientPage
      ).items.map((c) => c.id);
    expect(await list('')).toHaveLength(3);
    expect((await list('&hasDebt=true')).sort()).toEqual([owes.id, over.id].sort());
    expect(await list('&overLimit=true')).toEqual([over.id]);
    expect(
      ((await as(a).get(`/clients?search=07${tag}`).expect(200)).body as ClientPage).items.map(
        (c) => c.id,
      ),
    ).toEqual([owes.id]);

    // Phase 33: the dashboard's crédit card opens the list by balance, biggest first, and the
    // cursor walks that order without repeating or skipping anyone.
    expect(await list('&sort=balance_desc')).toEqual([owes.id, over.id, credit.id]);
    const first = (
      await as(a)
        .get(`/clients?search=${encodeURIComponent(tag)}&sort=balance_desc&limit=1`)
        .expect(200)
    ).body as ClientPage;
    const second = (
      await as(a)
        .get(
          `/clients?search=${encodeURIComponent(tag)}&sort=balance_desc&limit=2&cursor=${first.nextCursor}`,
        )
        .expect(200)
    ).body as ClientPage;
    expect([...first.items, ...second.items].map((c) => c.id)).toEqual([
      owes.id,
      over.id,
      credit.id,
    ]);
    await as(a).get('/clients?sort=oldest').expect(400);

    const debtors = (await as(a).get('/clients/debtors?limit=100').expect(200)).body as DebtorDto[];
    expect(debtors[0]?.id).toBe(owes.id);
    expect(debtors.map((d) => d.id)).not.toContain(credit.id);
    const sorted = [...debtors].sort((x, y) => money(y.balance).comparedTo(x.balance));
    expect(sorted.map((d) => d.id)).toEqual(debtors.map((d) => d.id));
  });

  it('cursor pagination walks every client once', async () => {
    const tag = randomUUID().slice(0, 6);
    for (let i = 0; i < 5; i++) await newClient(a, { name: `Page ${tag} ${i}` });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: ClientPage = (
        await as(a)
          .get(`/clients?search=${tag}&limit=2${cursor ? `&cursor=${cursor}` : ''}`)
          .expect(200)
      ).body as ClientPage;
      seen.push(...page.items.map((c) => c.name));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual([0, 1, 2, 3, 4].map((i) => `Page ${tag} ${i}`));
  });

  it('archived clients leave the list but keep their history', async () => {
    const c = await newClient(a);
    await post(a, c.id, '100');
    await as(a).delete(`/clients/${c.id}`).expect(204);
    const page = (await as(a).get(`/clients?search=${c.code}`).expect(200)).body as ClientPage;
    expect(page.items.map((x) => x.id)).not.toContain(c.id);
    expect((await fetchClient(a, c.id)).archivedAt).not.toBeNull();
    await as(a)
      .post(`/clients/${c.id}/adjustments`, { amount: '1', reason: 'après archive' })
      .expect(404);
  });

  it('tenant B cannot read or write tenant A clients', async () => {
    const c = await newClient(a);
    await as(b).get(`/clients/${c.id}`).expect(404);
    await as(b).get(`/clients/${c.id}/statement?from=2026-01-01&to=2026-12-31`).expect(404);
    await as(b)
      .post(`/clients/${c.id}/adjustments`, { amount: '1', reason: 'intrusion' })
      .expect(404);
    const page = (await as(b).get('/clients?limit=100').expect(200)).body as ClientPage;
    expect(page.items.map((x) => x.id)).not.toContain(c.id);
  });

  it('ledger entries cannot be updated or deleted, even with raw SQL', async () => {
    await expect(
      asTenant(a.tenantId, () => t.prisma.db.clientLedgerEntry.deleteMany({})),
    ).rejects.toThrow(/append-only/);
    await expect(
      asTenant(
        a.tenantId,
        () => t.prisma.db.$executeRaw`UPDATE client_ledger_entries SET label = 'x'`,
      ),
    ).rejects.toThrow(/append-only/);
  });

  // Last on purpose: everything above must leave the ledger and the cache in agreement.
  it('reconcile finds no difference; only the owner may run it', async () => {
    for (const who of [a, b]) {
      const report = (await as(who).get('/clients/reconcile').expect(200))
        .body as ClientReconcileReport;
      expect(report.differences).toEqual([]);
    }
    const manager = await loginAs(a, 'MANAGER');
    await as(manager).get('/clients/reconcile').expect(403);
  });
});
