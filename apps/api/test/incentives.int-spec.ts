import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import {
  Activity,
  type ApiError,
  type AuthResponse,
  type BrandDto,
  type ClientDto,
  ErrorCode,
  type IncentivePlanDto,
  type IncentiveRunDetailDto,
  type InviteResultDto,
  metricKey,
  type MyObjectivesDto,
  type PaymentDto,
  type ProductDto,
  type RuleInput,
  type SaleResultDto,
  type SalesTargetDto,
  type UserDto,
} from '@erp/shared';
import {
  asTenant,
  bearer,
  catalogOf,
  createTestApp,
  registerTenant,
  type RegisteredTenant,
  tamper,
  type TenantCatalog,
  type TestApp,
  withoutGeoCheck,
} from './helpers';

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Algiers' }).format(new Date());
const CUR = TODAY.slice(0, 7);
const PREV = (() => {
  const [y, m] = CUR.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
})();
const NEXT = (() => {
  const [y, m] = CUR.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
})();
const PASSWORD = 'Password123!';
const errorOf = (res: { body: unknown }) => res.body as ApiError;
const newPhone = (): string =>
  `0${5 + Math.floor(Math.random() * 3)}${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

type Who = { auth: { accessToken: string } };
type Staff = Who & { user: UserDto };

describe('objectifs & primes (phase 18)', () => {
  let t: TestApp;
  let seq = 0;
  const ip = () => `10.18.${Math.floor(++seq / 200)}.${seq % 200}`;

  const as = (who: Who) => ({
    get: (url: string) =>
      t
        .http()
        .get(url)
        .set(...bearer(who.auth.accessToken)),
    post: (url: string, body: object = {}) =>
      t
        .http()
        .post(url)
        .set(...bearer(who.auth.accessToken))
        .set('Idempotency-Key', randomUUID())
        .send(body),
    put: (url: string, body: object) =>
      t
        .http()
        .put(url)
        .set(...bearer(who.auth.accessToken))
        .send(body),
    patch: (url: string, body: object) =>
      t
        .http()
        .patch(url)
        .set(...bearer(who.auth.accessToken))
        .send(body),
  });

  const staff = async (
    owner: RegisteredTenant,
    role: string,
    managerId?: string,
  ): Promise<Staff> => {
    const phone = newPhone();
    const invited = (
      await t
        .http()
        .post('/users/invite')
        .set(...bearer(owner.auth.accessToken))
        .send({
          fullName: `${role} ${++seq}`,
          phone,
          role,
          mode: 'PASSWORD',
          password: 'Temporary1!',
          ...(managerId ? { managerId } : {}),
        })
        .expect(201)
    ).body as InviteResultDto;
    const login = (password: string) =>
      t
        .http()
        .post('/auth/login')
        .set('X-Forwarded-For', ip())
        .set('X-Client-Type', 'native')
        .send({ identifier: phone, password });
    const first = (await login('Temporary1!').expect(200)).body as AuthResponse;
    await t
      .http()
      .post('/auth/password')
      .set(...bearer(first.accessToken))
      .send({ currentPassword: 'Temporary1!', newPassword: PASSWORD })
      .expect(200);
    const auth = (await login(PASSWORD).expect(200)).body as AuthResponse;
    return { auth, user: invited.user };
  };

  /** Pièce at 100 DA HT, TVA 19 %, 100 in stock at a CUMP of 60. */
  const product = async (who: RegisteredTenant, cat: TenantCatalog, brandId: string | null) => {
    const piece = cat.units['PIECE']!.id;
    const p = (
      await as(who)
        .post('/products', {
          reference: `IN-${Date.now()}-${++seq}`,
          designation: `Article ${seq}`,
          baseUnitId: piece,
          tvaRate: '19',
          brandId,
          units: [
            {
              unitId: piece,
              factorToBase: '1',
              barcode: null,
              isDefaultSale: true,
              isDefaultPurchase: true,
            },
          ],
          prices: cat.levels.slice(0, 3).map((l) => ({
            unitId: piece,
            priceLevelId: l.id,
            priceHt: '100',
          })),
        })
        .expect(201)
    ).body as ProductDto;
    await as(who)
      .post('/stock/opening', {
        lines: [{ productId: p.id, unitId: piece, qty: '100', unitCost: '60' }],
      })
      .expect(201);
    return { id: p.id, piece };
  };

  const client = async (who: Who) =>
    (
      await as(who)
        .post('/clients', { code: `IN${++seq}`, name: `Client ${seq}` })
        .expect(201)
    ).body as ClientDto;

  const sell = async (
    who: Who,
    item: { id: string; piece: string },
    qty: string,
    body: Record<string, unknown>,
  ) =>
    (
      (
        await as(who)
          .post('/sales/quick', {
            documentDate: TODAY,
            lines: [{ productId: item.id, unitId: item.piece, qty }],
            ...body,
          })
          .expect(201)
      ).body as SaleResultDto
    ).sale;

  const plan = async (who: Who, validFrom: string, rules: RuleInput[]) => {
    let p = (
      await as(who)
        .post('/incentive-plans', { name: 'Primes vendeurs', period: 'MONTH', validFrom })
        .expect(201)
    ).body as IncentivePlanDto;
    for (const r of rules) {
      p = (await as(who).post(`/incentive-plans/${p.id}/rules`, r).expect(201))
        .body as IncentivePlanDto;
    }
    return p;
  };

  const preview = (who: Who, planId: string, period: string) =>
    as(who).post('/incentive-runs', { planId, period });

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  describe('a seeded month', () => {
    let d: RegisteredTenant;
    let other: RegisteredTenant;
    let cat: TenantCatalog;
    let manager: Staff;
    let sup: Staff;
    let mid: Staff;
    let a: Staff;
    let b: Staff;
    let brand: BrandDto;
    let p1: { id: string; piece: string };
    let p2: { id: string; piece: string };
    let saleOfB: string;
    let paymentOfA: PaymentDto;
    let thePlan: IncentivePlanDto;
    let run: IncentiveRunDetailDto;

    beforeAll(async () => {
      d = await registerTenant(t, 'Distrib Primes', { activity: Activity.DISTRIBUTEUR });
      await withoutGeoCheck(t, d);
      other = await registerTenant(t, 'Autre Distrib', { activity: Activity.DISTRIBUTEUR });
      cat = await catalogOf(t, d);
      manager = await staff(d, 'MANAGER');
      // A 3-level tree: supervisor → (seller A, supervisor mid → seller B).
      sup = await staff(d, 'SUPERVISOR');
      a = await staff(d, 'SELLER', sup.user.id);
      mid = await staff(d, 'SUPERVISOR', sup.user.id);
      b = await staff(d, 'SELLER', mid.user.id);
      brand = (
        await as(d)
          .post('/brands', { name: `Marque ${++seq}` })
          .expect(201)
      ).body as BrandDto;
      p1 = await product(d, cat, brand.id);
      p2 = await product(d, cat, null);
      const c1 = await client(d);
      const c2 = await client(d);

      // A: BL 10 × P1 (1 000 HT, on credit), avoir of 3, BL 5 × P2 (500 HT), then both
      // BLs in one facture (counted once).
      const bl1 = await sell(d, p1, '10', { clientId: c1.id, sellerId: a.user.id });
      await as(d)
        .post(`/sales/${bl1.id}/returns`, {
          disposition: 'RESTOCK',
          reason: 'casse client',
          lines: [{ saleLineId: bl1.lines[0]!.id, qty: '3' }],
        })
        .expect(201);
      const bl2 = await sell(d, p2, '5', { clientId: c1.id, sellerId: a.user.id });
      await as(d)
        .post('/invoices/from-bls', { saleIds: [bl1.id, bl2.id], documentDate: TODAY })
        .expect(201);
      // B: a direct facture 2 × P1 paid at once, and a BL cancelled the same month.
      saleOfB = (
        await sell(d, p1, '2', {
          type: 'FACTURE',
          clientId: c2.id,
          sellerId: b.user.id,
          paidAmount: '238',
        })
      ).id;
      const cancelled = await sell(d, p2, '4', { sellerId: b.user.id, paidAmount: '476' });
      await as(d).post(`/sales/${cancelled.id}/cancel`, { reason: 'erreur saisie' }).expect(200);
      // A collects 500 in cash and a cheque of 200 that bounces.
      paymentOfA = (await as(a).post('/payments', { clientId: c1.id, amount: '500' }).expect(201))
        .body as PaymentDto;
      const cheque = (
        await as(a)
          .post('/payments', {
            clientId: c1.id,
            amount: '200',
            mode: 'CHEQUE',
            reference: 'CHQ-1',
            bank: 'BNA',
            dueDate: TODAY,
          })
          .expect(201)
      ).body as PaymentDto;
      await as(d).post(`/payments/${cheque.id}/bounce`, { reason: 'sans provision' }).expect(200);

      const rec = { metric: 'RECOUVREMENT_PCT', min: '20' } as const;
      thePlan = await plan(d, `${PREV}-01`, [
        {
          name: 'Paliers CA',
          appliesTo: 'ROLE',
          roleOrUserId: 'SELLER',
          params: {
            type: 'TIERS',
            metric: 'CA_HT',
            mode: 'HIGHEST_REACHED',
            tiers: [
              { fromPct: '80', amount: '1000' },
              { fromPct: '100', amount: '2000' },
            ],
            gates: [rec],
          },
        },
        {
          name: 'Commission encaissement',
          appliesTo: 'ROLE',
          roleOrUserId: 'SELLER',
          params: { type: 'COMMISSION', metric: 'ENCAISSEMENT', ratePct: '10' },
        },
        {
          name: 'Par pièce marque',
          appliesTo: 'ROLE',
          roleOrUserId: 'SELLER',
          params: { type: 'PER_UNIT', scope: { brandId: brand.id }, amountPerUnit: '5' },
        },
        {
          name: 'Nouveaux clients',
          appliesTo: 'ROLE',
          roleOrUserId: 'SELLER',
          params: { type: 'FIXED_ON_TARGET', metric: 'NEW_CLIENTS', minPct: '100', amount: '300' },
        },
        {
          name: 'Override équipe',
          appliesTo: 'ROLE',
          roleOrUserId: 'SUPERVISOR',
          params: { type: 'MANAGER_OVERRIDE', metric: 'CA_HT', ratePct: '1' },
        },
        {
          name: 'Objectif équipe',
          appliesTo: 'TEAM_MANAGER',
          roleOrUserId: sup.user.id,
          params: { type: 'FIXED_ON_TARGET', metric: 'CA_HT', minPct: '100', amount: '5000' },
        },
      ]);
      await as(d).post(`/incentive-plans/${thePlan.id}/activate`).expect(200);

      const bulk = (metric: string, rows: object[]) =>
        as(d).put('/sales-targets/bulk', { period: CUR, metric, rows }).expect(200);
      await bulk('CA_HT', [
        { userId: a.user.id, value: '1200' },
        { userId: b.user.id, value: '1000' },
        { teamManagerId: sup.user.id, value: '1400' },
      ]);
      await bulk('NEW_CLIENTS', [{ userId: a.user.id, value: '1' }]);
    });

    const lineOf = (r: IncentiveRunDetailDto, userId: string, rule: string) =>
      r.users.find((u) => u.user.id === userId)?.lines.find((l) => l.ruleName === rule);

    it('computes the figures from sales, factures, avoirs, cancels, versements and bounces', async () => {
      run = (await preview(d, thePlan.id, CUR).expect(200)).body as IncentiveRunDetailDto;
      expect(run.status).toBe('PREVIEW');

      const tiersA = lineOf(run, a.user.id, 'Paliers CA')!;
      // 1 000 + 500 − 300 (avoir); the facture of the two BLs is not counted again.
      expect(tiersA.explanation).toMatchObject({
        achieved: '1200.00',
        target: '1200.00',
        pct: '100.00',
        outcome: 'PAID',
        tier: { index: 1, fromPct: '100' },
      });
      // Recouvrement: 500 collected (the bounced cheque taken back) over 1 785 left on credit.
      expect(tiersA.explanation.gates).toEqual([
        { metric: 'RECOUVREMENT_PCT', value: '28.01', min: '20', passed: true },
      ]);
      expect(tiersA.amount).toBe('2000.00');
      expect(lineOf(run, a.user.id, 'Commission encaissement')!.amount).toBe('50.00');
      // 10 − 3 pièces of the brand.
      expect(lineOf(run, a.user.id, 'Par pièce marque')!.explanation).toMatchObject({
        units: '7',
        amount: '35.00',
      });
      expect(lineOf(run, a.user.id, 'Nouveaux clients')!.amount).toBe('300.00');

      // B: the facture (200) counts, the cancelled BL nets to zero.
      const tiersB = lineOf(run, b.user.id, 'Paliers CA')!;
      expect(tiersB.explanation).toMatchObject({ achieved: '200.00', outcome: 'BELOW_MIN' });
      // No credit sale of his own: recouvrement is 100 %.
      expect(tiersB.explanation.gates[0]).toMatchObject({ value: '100.00', passed: true });
      expect(lineOf(run, b.user.id, 'Par pièce marque')!.amount).toBe('10.00');
      expect(lineOf(run, b.user.id, 'Nouveaux clients')!.explanation.outcome).toBe('NO_TARGET');

      // The supervisor: 1 % of the 3-level team's CA (1 200 + 200), and the team target.
      expect(lineOf(run, sup.user.id, 'Override équipe')!.amount).toBe('14.00');
      expect(lineOf(run, sup.user.id, 'Objectif équipe')!.explanation).toMatchObject({
        achieved: '1400.00',
        target: '1400.00',
        outcome: 'PAID',
      });
      // The middle supervisor: 1 % of B's 200; the team rule is the top supervisor's only.
      expect(lineOf(run, mid.user.id, 'Override équipe')!.amount).toBe('2.00');
      expect(lineOf(run, mid.user.id, 'Objectif équipe')).toBeUndefined();
      expect(run.users.find((u) => u.user.id === a.user.id)!.total).toBe('2385.00');
      expect(run.total).toBe('7411.00');
      expect(run.scopeLabels[`b:${brand.id}`]).toBe(brand.name);
    });

    it('a preview is recomputed in place: same run, lines replaced', async () => {
      const again = (await preview(d, thePlan.id, CUR).expect(200)).body as IncentiveRunDetailDto;
      expect(again.id).toBe(run.id);
      const lines = await asTenant(d.tenantId, () =>
        t.prisma.db.incentiveLine.count({ where: { runId: run.id } }),
      );
      expect(lines).toBe(again.users.reduce((s, u) => s + u.lines.length, 0));
    });

    it('live progress: each seller sees only his own objectives, a supervisor his team', async () => {
      const mineA = (await as(a).get('/me/objectives').expect(200)).body as MyObjectivesDto;
      expect(mineA.period).toBe(CUR);
      expect(mineA.items.map((i) => i.subject.id)).toEqual([a.user.id, a.user.id]);
      const caA = mineA.items.find((i) => i.metric === 'CA_HT')!;
      // Both tiers reached: nothing left.
      expect(caA).toMatchObject({ achieved: '1200.00', pct: '100.00', next: null, team: false });

      const mineB = (await as(b).get('/me/objectives').expect(200)).body as MyObjectivesDto;
      expect(mineB.items).toHaveLength(1);
      expect(mineB.items[0]).toMatchObject({
        achieved: '200.00',
        pct: '20.00',
        next: { pct: '80', remaining: '600.00' },
      });

      const mineS = (await as(sup).get('/me/objectives').expect(200)).body as MyObjectivesDto;
      const team = mineS.items.find((i) => i.team)!;
      expect(team).toMatchObject({ achieved: '1400.00', pct: '100.00', next: null });
      expect(new Set(mineS.items.map((i) => i.subject.id))).toEqual(
        new Set([sup.user.id, a.user.id, b.user.id]),
      );

      // A seller neither reads the runs nor the targets grid.
      await as(a).get(`/incentive-runs/${run.id}`).expect(403);
      await as(a).get(`/sales-targets?period=${CUR}`).expect(403);
      // A supervisor reads his team's targets, but does not set them.
      const supTargets = (await as(sup).get(`/sales-targets?period=${CUR}`).expect(200))
        .body as SalesTargetDto[];
      expect(supTargets).toHaveLength(4);
      await as(sup)
        .put('/sales-targets/bulk', {
          period: CUR,
          metric: 'CA_HT',
          rows: [{ userId: b.user.id, value: '1' }],
        })
        .expect(403);
    });

    it('refuses invalid rules: scope on a money-only metric, margin without permission', async () => {
      const draft = await plan(d, `${CUR}-01`, []);
      const bad = await as(d)
        .post(`/incentive-plans/${draft.id}/rules`, {
          name: 'x',
          appliesTo: 'ROLE',
          roleOrUserId: 'SELLER',
          params: {
            type: 'COMMISSION',
            metric: 'ENCAISSEMENT',
            scope: { brandId: brand.id },
            ratePct: '1',
          },
        })
        .expect(400);
      expect(errorOf(bad).code).toBe(ErrorCode.VALIDATION_FAILED);
      await as(d)
        .post(`/incentive-plans/${draft.id}/rules`, {
          name: 'x',
          appliesTo: 'ROLE',
          roleOrUserId: 'SELLER',
          params: { type: 'FIXED_ON_TARGET', metric: 'CA_HT', minPct: '100', amount: 100 },
        })
        .expect(400);
      // An empty plan cannot be activated.
      const empty = await as(d).post(`/incentive-plans/${draft.id}/activate`).expect(422);
      expect(errorOf(empty).code).toBe(ErrorCode.INCENTIVE_PLAN_EMPTY);
    });

    it('approve: owner only (or INCENTIVE_APPROVE), audited, frozen', async () => {
      const denied = await as(manager).post(`/incentive-runs/${run.id}/approve`).expect(403);
      expect(errorOf(denied).details).toMatchObject({ permission: 'INCENTIVE_APPROVE' });

      const approved = (await as(d).post(`/incentive-runs/${run.id}/approve`).expect(200))
        .body as IncentiveRunDetailDto;
      expect(approved.status).toBe('APPROVED');
      expect(approved.approvedBy?.id).toBe(d.auth.user.id);
      expect(approved.total).toBe('7411.00');
      const audit = await asTenant(d.tenantId, () =>
        t.prisma.db.auditLog.findFirstOrThrow({
          where: { action: 'INCENTIVE_RUN_APPROVED', entityId: run.id },
        }),
      );
      expect(audit.after).toMatchObject({ total: '7411.00', period: CUR });

      // Twice is refused; recomputing is refused.
      const twice = await as(d).post(`/incentive-runs/${run.id}/approve`).expect(409);
      expect(errorOf(twice).code).toBe(ErrorCode.INCENTIVE_RUN_NOT_PREVIEW);
      const recompute = await preview(d, thePlan.id, CUR).expect(409);
      expect(errorOf(recompute).code).toBe(ErrorCode.INCENTIVE_RUN_APPROVED);

      // Even raw SQL cannot change its lines or reopen it.
      await expect(
        tamper(t)`UPDATE incentive_lines SET amount = 0 WHERE "runId" = ${run.id}::uuid`,
      ).rejects.toThrow(/approved/);
      await expect(
        tamper(t)`UPDATE incentive_runs SET status = 'PREVIEW' WHERE id = ${run.id}::uuid`,
      ).rejects.toThrow(/frozen/);
      await expect(
        tamper(t)`DELETE FROM incentive_lines WHERE "runId" = ${run.id}::uuid`,
      ).rejects.toThrow(/approved/);
    });

    it('after approval: the period is frozen for seller / collector changes and targets', async () => {
      const sale = await as(d)
        .patch(`/sales/${saleOfB}/seller`, { sellerId: a.user.id, reason: 'mauvais vendeur' })
        .expect(409);
      expect(errorOf(sale).code).toBe(ErrorCode.PERIOD_APPROVED);
      const pay = await as(d)
        .patch(`/payments/${paymentOfA.id}/collector`, {
          collectedBy: b.user.id,
          reason: 'mauvais encaisseur',
        })
        .expect(409);
      expect(errorOf(pay).code).toBe(ErrorCode.PERIOD_APPROVED);
      const target = await as(d)
        .put('/sales-targets/bulk', {
          period: CUR,
          metric: 'CA_HT',
          rows: [{ userId: b.user.id, value: '1' }],
        })
        .expect(409);
      expect(errorOf(target).code).toBe(ErrorCode.PERIOD_APPROVED);
      // Next month is open.
      await as(d)
        .put('/sales-targets/bulk', {
          period: NEXT,
          metric: 'CA_HT',
          rows: [{ userId: b.user.id, value: '1' }],
        })
        .expect(200);
    });

    it('exports the approved run for payroll: one row per user, then EXPORTED', async () => {
      const res = await as(d)
        .get(`/incentive-runs/${run.id}/export.xlsx`)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body as ExcelJS.Buffer);
      const sheet = wb.worksheets[0]!;
      const header = sheet.getRow(4).values as unknown[];
      expect(header).toContain('Paliers CA');
      expect(header).toContain('Total');
      const names = [5, 6, 7, 8].map((i) => sheet.getRow(i).getCell(1).value);
      expect(new Set(names)).toEqual(
        new Set([sup.user.fullName, mid.user.fullName, a.user.fullName, b.user.fullName]),
      );
      const rowA = [5, 6, 7, 8]
        .map((i) => sheet.getRow(i))
        .find((r) => r.getCell(1).value === a.user.fullName)!;
      expect(rowA.getCell(rowA.cellCount).value).toBe(2385);
      const after = (await as(d).get(`/incentive-runs/${run.id}`).expect(200))
        .body as IncentiveRunDetailDto;
      expect(after.status).toBe('EXPORTED');
      expect(after.exportedAt).not.toBeNull();
    });

    it('tenant isolation', async () => {
      await as(other).get(`/incentive-runs/${run.id}`).expect(404);
      await as(other).get(`/incentive-plans/${thePlan.id}`).expect(404);
      await as(other).post(`/incentive-runs/${run.id}/approve`).expect(404);
      expect(
        ((await as(other).get(`/sales-targets?period=${CUR}`).expect(200)).body as []).length,
      ).toBe(0);
      const notMine = await as(other).post('/incentive-runs', { planId: thePlan.id, period: CUR });
      expect(notMine.status).toBe(404);
    });
  });

  describe('versions, clawback and the module switch', () => {
    let d: RegisteredTenant;
    let a: Staff;
    let item: { id: string; piece: string };

    beforeAll(async () => {
      d = await registerTenant(t, 'Distrib Versions', { activity: Activity.DISTRIBUTEUR });
      await withoutGeoCheck(t, d);
      const cat = await catalogOf(t, d);
      a = await staff(d, 'SELLER');
      item = await product(d, cat, null);
    });

    const commission = (ratePct: string): RuleInput => ({
      name: 'Commission CA',
      appliesTo: 'ROLE',
      roleOrUserId: 'SELLER',
      params: { type: 'COMMISSION', metric: 'CA_HT', ratePct },
    });

    it('an avoir after an approved month lowers the next month, the past stays', async () => {
      const p = await plan(d, `${PREV}-01`, [commission('10')]);
      await as(d).post(`/incentive-plans/${p.id}/activate`).expect(200);
      // A sale of last month (10 × 100 HT).
      const c = await client(d);
      const sale = await sell(d, item, '10', { clientId: c.id, sellerId: a.user.id });
      const lastMonth = new Date(`${PREV}-15T10:00:00+01:00`);
      await tamper(t)`UPDATE sales SET "validatedAt" = ${lastMonth} WHERE id = ${sale.id}::uuid`;

      const prev = (await preview(d, p.id, PREV).expect(200)).body as IncentiveRunDetailDto;
      expect(prev.total).toBe('100.00');
      await as(d).post(`/incentive-runs/${prev.id}/approve`).expect(200);

      // This month: the client brings 4 back.
      await as(d)
        .post(`/sales/${sale.id}/returns`, {
          disposition: 'RESTOCK',
          reason: 'retour client',
          lines: [{ saleLineId: sale.lines[0]!.id, qty: '4' }],
        })
        .expect(201);
      const cur = (await preview(d, p.id, CUR).expect(200)).body as IncentiveRunDetailDto;
      const line = cur.users.find((u) => u.user.id === a.user.id)!.lines[0]!;
      expect(line.explanation.achieved).toBe('-400.00');
      expect(line.amount).toBe('0.00');
      const again = (await as(d).get(`/incentive-runs/${prev.id}`).expect(200))
        .body as IncentiveRunDetailDto;
      expect(again.total).toBe('100.00');
      // The seller of last month's sale is locked.
      await as(d)
        .patch(`/sales/${sale.id}/seller`, { sellerId: null, reason: 'mauvais vendeur' })
        .expect(409);
    });

    it('concurrent previews and approvals: one run, approved once', async () => {
      const p = await plan(d, `${PREV}-01`, [commission('2')]);
      await as(d).post(`/incentive-plans/${p.id}/activate`).expect(200);
      const both = await Promise.all([preview(d, p.id, NEXT), preview(d, p.id, NEXT)]);
      expect(both.map((r) => r.status)).toEqual([200, 200]);
      const ids = both.map((r) => (r.body as IncentiveRunDetailDto).id);
      expect(ids[0]).toBe(ids[1]);
      const approvals = await Promise.all([
        as(d).post(`/incentive-runs/${ids[0]}/approve`),
        as(d).post(`/incentive-runs/${ids[0]}/approve`),
      ]);
      expect(approvals.map((r) => r.status).sort()).toEqual([200, 409]);
      // A preview cannot be exported.
      const draftRun = (await preview(d, p.id, CUR).expect(200)).body as IncentiveRunDetailDto;
      const exp = await as(d).get(`/incentive-runs/${draftRun.id}/export.xlsx`).expect(409);
      expect(errorOf(exp).code).toBe(ErrorCode.INCENTIVE_RUN_NOT_APPROVED);
    });

    it('versions: an active plan is never edited; a new version ends the previous one', async () => {
      const v1 = await plan(d, `${PREV}-01`, [commission('1')]);
      await as(d).post(`/incentive-plans/${v1.id}/activate`).expect(200);
      const edit = await as(d).patch(`/incentive-plans/${v1.id}`, { name: 'Autre' }).expect(409);
      expect(errorOf(edit).code).toBe(ErrorCode.INCENTIVE_PLAN_NOT_DRAFT);
      await as(d).post(`/incentive-plans/${v1.id}/rules`, commission('2')).expect(409);

      // A version must start after the current one.
      await as(d)
        .post(`/incentive-plans/${v1.id}/new-version`, { validFrom: `${PREV}-01` })
        .expect(400);
      const v2 = (
        await as(d)
          .post(`/incentive-plans/${v1.id}/new-version`, { validFrom: `${NEXT}-01` })
          .expect(201)
      ).body as IncentivePlanDto;
      expect(v2).toMatchObject({ familyId: v1.familyId, version: 2, status: 'DRAFT' });
      expect(v2.rules.map((r) => r.params)).toEqual(v1.rules.map((r) => r.params));
      await as(d)
        .put(`/incentive-plans/${v2.id}/rules/${v2.rules[0]!.id}`, commission('3'))
        .expect(200);
      await as(d).post(`/incentive-plans/${v2.id}/activate`).expect(200);

      const after = (await as(d).get(`/incentive-plans/${v1.id}`).expect(200))
        .body as IncentivePlanDto;
      expect(after.status).toBe('ACTIVE');
      expect(after.validTo?.slice(0, 7)).toBe(CUR);
      // v1 no longer covers next month; v2 does, with its own rate.
      await preview(d, v1.id, NEXT).expect(400);
      const next = (await preview(d, v2.id, NEXT).expect(200)).body as IncentiveRunDetailDto;
      expect(next.users[0]!.lines[0]!.explanation.ratePct).toBe('3');
    });

    it('the module off: every route answers FEATURE_NOT_IN_PLAN', async () => {
      const e = await registerTenant(t, 'Grossiste Primes');
      for (const url of [
        '/incentive-plans',
        '/incentive-runs',
        '/me/objectives',
        `/sales-targets?period=${CUR}`,
      ]) {
        const res = await as(e).get(url).expect(403);
        expect(errorOf(res).code).toBe(ErrorCode.FEATURE_NOT_IN_PLAN);
      }
    });

    it('margin targets need VIEW_COST_AND_MARGIN; scopes are checked', async () => {
      const k = metricKey({ metric: 'MARGE' });
      expect(k).toBe('MARGE');
      const missing = await as(d)
        .put('/sales-targets/bulk', {
          period: CUR,
          metric: 'CA_HT',
          scope: { brandId: randomUUID() },
          rows: [{ userId: a.user.id, value: '10' }],
        })
        .expect(404);
      expect(errorOf(missing).code).toBe(ErrorCode.NOT_FOUND);
      const sellerTry = await as(a)
        .put('/sales-targets/bulk', {
          period: CUR,
          metric: 'MARGE',
          rows: [{ userId: a.user.id, value: '10' }],
        })
        .expect(403);
      expect(errorOf(sellerTry).code).toBe(ErrorCode.FORBIDDEN);
    });
  });
});
