import { randomUUID } from 'node:crypto';
import {
  Activity,
  algiersDay,
  type ApiError,
  type AuthResponse,
  type CashAccountDto,
  type CashCountDto,
  type CashMovementPage,
  type CashTransferDto,
  type ChargesReportDto,
  type ClientDto,
  type DashboardDto,
  ErrorCode,
  type ExpenseCategoryDto,
  type ExpenseDto,
  type ImportFileDto,
  type InviteResultDto,
  type OverviewDto,
  type PaymentDto,
  type PurchaseDto,
  type SupplierDto,
  type SupplierPaymentDto,
  type TreasuryReconcileDto,
  type TreasurySummaryDto,
  type WarehouseDto,
} from '@erp/shared';
import { FeaturesService } from '../src/billing/features.service';
import { tenantContext } from '../src/common/tenant-context';
import { ReconcileService } from '../src/reconcile/reconcile.service';
import { TreasuryBackfillService } from '../src/treasury/treasury-backfill.service';
import {
  bearer,
  catalogOf,
  createProduct,
  createTestApp,
  registerTenant,
  type RegisteredTenant,
  tamper,
  type TenantCatalog,
  type TestApp,
  uniqueEmail,
  withoutGeoCheck,
} from './helpers';

type Who = { auth: { accessToken: string } };
interface Member {
  id: string;
  auth: AuthResponse;
}

const TODAY = algiersDay();
const dayBefore = (n: number): string => {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

/** Trésorerie: caisses, comptes, soldes (phase 34). */
describe('treasury (phase 34)', () => {
  let t: TestApp;
  let seq = 0;

  const as = (who: Who) => ({
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
      if (key) void req.set('Idempotency-Key', key);
      return req.send(body);
    },
    patch: (url: string, body: object) =>
      t
        .http()
        .patch(url)
        .set(...bearer(who.auth.accessToken))
        .send(body),
    put: (url: string, body: object) =>
      t
        .http()
        .put(url)
        .set(...bearer(who.auth.accessToken))
        .send(body),
    delete: (url: string) =>
      t
        .http()
        .delete(url)
        .set(...bearer(who.auth.accessToken)),
  });

  const read = <T>(sql: TemplateStringsArray, ...values: unknown[]) =>
    tenantContext.runAsSystem(() => t.prisma.db.$queryRaw<T>(sql, ...values));

  const invite = async (who: RegisteredTenant, role: 'SELLER' | 'MANAGER'): Promise<Member> => {
    const email = uniqueEmail(role.toLowerCase());
    const res = await as(who)
      .post(
        '/users/invite',
        { fullName: `${role} ${++seq}`, email, role, mode: 'PASSWORD', password: 'Password123!' },
        null,
      )
      .expect(201);
    const user = (res.body as InviteResultDto).user;
    const login = await t
      .http()
      .post('/auth/login')
      .send({ email, password: 'Password123!' })
      .expect(200);
    await t
      .http()
      .post('/auth/password')
      .set(...bearer((login.body as AuthResponse).accessToken))
      .send({ currentPassword: 'Password123!', newPassword: 'Password456!' })
      .expect((r) => {
        if (r.status >= 300) throw new Error(`password change: ${r.status}`);
      });
    const relog = await t
      .http()
      .post('/auth/login')
      .send({ email, password: 'Password456!' })
      .expect(200);
    return { id: user.id, auth: relog.body as AuthResponse };
  };

  const accounts = async (who: Who, query = '') =>
    (await as(who).get(`/cash-accounts${query}`).expect(200)).body as CashAccountDto[];
  const byName = async (who: Who, name: string) =>
    (await accounts(who)).find((a) => a.name === name)!;
  const caisse = (who: Who) => byName(who, 'Caisse principale');
  const banque = (who: Who) => byName(who, 'Banque principale');
  const balance = async (who: Who, id: string) =>
    (await as(who).get(`/cash-accounts/${id}`).expect(200)).body as CashAccountDto;
  const movements = async (who: Who, id: string, query = '') =>
    (await as(who).get(`/cash-accounts/${id}/movements${query}`).expect(200))
      .body as CashMovementPage;
  const newAccount = async (who: Who, body: object) =>
    (
      await as(who)
        .post('/cash-accounts', { name: `Compte ${++seq}`, type: 'BANQUE', ...body }, null)
        .expect(201)
    ).body as CashAccountDto;

  const client = async (who: Who) =>
    (
      await as(who)
        .post('/clients', { code: `T${++seq}`, name: `Client ${seq}` }, null)
        .expect(201)
    ).body as ClientDto;
  const supplier = async (who: Who, currency = 'DZD') =>
    (
      await as(who)
        .post('/suppliers', { name: `Fournisseur ${++seq}`, currency }, null)
        .expect(201)
    ).body as SupplierDto;
  const supplierBalance = async (who: Who, id: string) =>
    ((await as(who).get(`/suppliers/${id}`).expect(200)).body as SupplierDto & { balance: string })
      .balance;
  const versement = async (who: Who, body: object = {}) => {
    const c = await client(who);
    return (
      await as(who)
        .post('/payments', { clientId: c.id, amount: '1000', mode: 'ESPECES', ...body })
        .expect(201)
    ).body as PaymentDto;
  };
  const categories = async (who: Who) =>
    (await as(who).get('/expense-categories').expect(200)).body as ExpenseCategoryDto[];
  const expense = async (who: Who, body: object = {}) => {
    const cats = await categories(who);
    const categoryId = cats.find((c) => c.key === 'OTHER')?.id ?? cats[0]!.id;
    return (
      await as(who)
        .post('/expenses', { amount: '400', mode: 'ESPECES', categoryId, ...body })
        .expect(201)
    ).body as ExpenseDto;
  };
  const opening = (who: Who, id: string, amount: string, date = TODAY) =>
    as(who).post(`/cash-accounts/${id}/opening`, { amount, date });

  /** A BR with one line of 10 cartons at 1 000 HT (TTC 11 900 at 19 %). */
  const br = async (
    who: RegisteredTenant,
    cat: TenantCatalog,
    body: object = {},
  ): Promise<{ draft: PurchaseDto; supplierId: string }> => {
    const s = await supplier(who);
    const p = await createProduct(t, who, cat);
    const draft = (
      await as(who)
        .post('/purchases', {
          supplierId: s.id,
          documentDate: TODAY,
          lines: [{ productId: p.id, unitId: p.cartonUnitId, qty: '10', unitCost: '1000' }],
          ...body,
        })
        .expect(201)
    ).body as PurchaseDto;
    return { draft, supplierId: s.id };
  };

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  describe('accounts', () => {
    let a: RegisteredTenant;
    beforeAll(async () => {
      a = await registerTenant(t, 'Comptes SARL');
    });

    it('seeds a caisse principale on the dépôt principal and a banque principale, once', async () => {
      const [first, second] = await Promise.all([accounts(a), accounts(a)]);
      expect(first.map((x) => [x.name, x.type, x.isDefault])).toEqual([
        ['Caisse principale', 'CAISSE', true],
        ['Banque principale', 'BANQUE', true],
      ]);
      expect(second).toHaveLength(2);
      expect(first[0]!.warehouse).not.toBeNull();
      expect(first[1]!.warehouse).toBeNull();
      expect(first[0]!.currency).toBe('DZD');
    });

    it('keeps one default per type and dépôt, and refuses a taken name', async () => {
      const b = await newAccount(a, { isDefault: true, bankName: 'BDL', rib: '00799999' });
      expect((await banque(a)).isDefault).toBe(false);
      expect(b.isDefault).toBe(true);
      const dup = await as(a)
        .post('/cash-accounts', { name: b.name.toUpperCase(), type: 'CCP' }, null)
        .expect(409);
      expect((dup.body as ApiError).code).toBe(ErrorCode.CASH_ACCOUNT_NAME_TAKEN);
    });

    it('refuses to archive a balance that is not zero, or the last default', async () => {
      const acc = await newAccount(a, {});
      await versement(a, { cashAccountId: acc.id, amount: '10' });
      const full = await as(a).delete(`/cash-accounts/${acc.id}`).expect(409);
      expect((full.body as ApiError).code).toBe(ErrorCode.CASH_ACCOUNT_NOT_EMPTY);
      const main = await caisse(a);
      const last = await as(a).delete(`/cash-accounts/${main.id}`).expect(409);
      expect((last.body as ApiError).code).toBe(ErrorCode.CASH_ACCOUNT_IS_DEFAULT);

      const empty = await newAccount(a, {});
      await as(a).delete(`/cash-accounts/${empty.id}`).expect(204);
      expect((await accounts(a)).some((x) => x.id === empty.id)).toBe(false);
      expect((await accounts(a, '?archived=true')).some((x) => x.id === empty.id)).toBe(true);
      // An archived account takes no more money.
      const c = await client(a);
      await as(a)
        .post('/payments', { clientId: c.id, amount: '5', cashAccountId: empty.id })
        .expect(404);
    });
  });

  describe('every money row writes one movement, and its cancel reverses it', () => {
    let a: RegisteredTenant;
    beforeAll(async () => {
      a = await registerTenant(t, 'Mouvements SARL');
    });

    it('a versement in cash goes to the caisse, and a replay moves nothing more', async () => {
      const main = await caisse(a);
      const before = main.balance!;
      const c = await client(a);
      const key = randomUUID();
      const body = { clientId: c.id, amount: '1500.50', mode: 'ESPECES' };
      const first = await as(a).post('/payments', body, key).expect(201);
      const replay = await as(a).post('/payments', body, key).expect(201);
      expect(replay.body).toEqual(first.body);
      const id = (first.body as PaymentDto).id;
      const after = await balance(a, main.id);
      expect(Number(after.balance) - Number(before)).toBeCloseTo(1500.5);
      const mine = (await movements(a, main.id)).items.filter((m) => m.refId === id);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ type: 'VERSEMENT', amount: '1500.50', counted: true });

      await as(a).post(`/payments/${id}/cancel`, { reason: 'erreur de saisie' }).expect(200);
      const reversed = (await movements(a, main.id)).items.filter((m) => m.refId === id);
      expect(reversed.map((m) => [m.type, m.amount])).toEqual([
        ['REVERSAL', '-1500.50'],
        ['VERSEMENT', '1500.50'],
      ]);
      expect((await balance(a, main.id)).balance).toBe(before);
    });

    it('a cheque goes to the bank, and a bounce takes it back from where it went', async () => {
      const bank = await banque(a);
      const other = await newAccount(a, {});
      const onDefault = await versement(a, { amount: '700', mode: 'CHEQUE', reference: 'C1' });
      const onOther = await versement(a, {
        amount: '300',
        mode: 'CHEQUE',
        reference: 'C2',
        cashAccountId: other.id,
      });
      expect((await balance(a, bank.id)).balance).toBe('700.00');
      expect((await balance(a, other.id)).balance).toBe('300.00');

      await as(a).post(`/payments/${onOther.id}/bounce`, { reason: 'sans provision' }).expect(200);
      expect((await balance(a, other.id)).balance).toBe('0.00');
      expect((await balance(a, bank.id)).balance).toBe('700.00');
      await as(a)
        .post(`/payments/${onDefault.id}/bounce`, { reason: 'sans provision' })
        .expect(200);
      expect((await balance(a, bank.id)).balance).toBe('0.00');
    });

    it('a règlement fournisseur leaves the account, and its cancel brings it back', async () => {
      const main = await caisse(a);
      const before = main.balance!;
      const s = await supplier(a);
      const p = (
        await as(a)
          .post('/supplier-payments', { supplierId: s.id, amount: '250', mode: 'ESPECES' })
          .expect(201)
      ).body as SupplierPaymentDto;
      expect(p.cashAccount?.id).toBe(main.id);
      const out = (await movements(a, main.id)).items.find((m) => m.refId === p.id)!;
      expect(out).toMatchObject({ type: 'SUPPLIER_PAYMENT', amount: '-250.00' });
      await as(a).post(`/supplier-payments/${p.id}/cancel`, { reason: 'erreur' }).expect(200);
      expect((await balance(a, main.id)).balance).toBe(before);
    });

    it('a dépense leaves the account at its own date, and its cancel brings it back', async () => {
      const main = await caisse(a);
      const before = main.balance!;
      const e = await expense(a, { date: dayBefore(3) });
      const out = (await movements(a, main.id)).items.find((m) => m.refId === e.id)!;
      expect(out).toMatchObject({ type: 'EXPENSE', amount: '-400.00', date: dayBefore(3) });
      await as(a).post(`/expenses/${e.id}/cancel`, { reason: 'erreur' }).expect(200);
      expect((await balance(a, main.id)).balance).toBe(before);
    });

    it('an account the user names beats the default', async () => {
      const bank = await banque(a);
      const before = (await balance(a, bank.id)).balance!;
      await expense(a, { cashAccountId: bank.id, amount: '10' });
      expect(Number((await balance(a, bank.id)).balance)).toBeCloseTo(Number(before) - 10);
    });
  });

  describe('avances and who sees them', () => {
    let d: RegisteredTenant;
    let manager: Member;
    beforeAll(async () => {
      d = await registerTenant(t, 'Avances SARL', { activity: Activity.DISTRIBUTEUR });
      await withoutGeoCheck(t, d);
      manager = await invite(d, 'MANAGER');
      const depots = (await as(d).get('/warehouses').expect(200)).body as WarehouseDto[];
      await as(d)
        .put(`/users/${manager.id}/access`, {
          access: depots.map((w) => ({ warehouseId: w.id, level: 'OPERATE' })),
        })
        .expect(200);
    });

    it('an avance writes one movement, reversed with it; the name stays behind SALARY_VIEW', async () => {
      const employee = (
        await as(d)
          .post(
            '/employees',
            {
              fullName: 'Karim Salaire',
              hireDate: '2026-01-01',
              contract: 'CDI',
              warehouseId: (await caisse(d)).warehouse!.id,
            },
            null,
          )
          .expect(201)
      ).body as { id: string };
      const main = await caisse(d);
      const before = main.balance!;
      const paid = (
        await as(d)
          .post(`/employees/${employee.id}/advances`, { amount: '3000', mode: 'ESPECES' })
          .expect(201)
      ).body as { expenseId?: string; id?: string };
      const seen = (await movements(d, main.id)).items.find((m) => m.amount === '-3000.00')!;
      expect(seen).toMatchObject({ type: 'EXPENSE', refType: 'Expense' });
      expect(seen.note).toMatch(/^DEP-/);

      // A manager has TREASURY_VIEW, not SALARY_VIEW: the amount, never the document.
      const hidden = (await movements(manager, main.id)).items.find((m) => m.id === seen.id)!;
      expect(hidden).toMatchObject({ amount: '-3000.00', refType: null, refId: null, note: null });
      expect(hidden.runningBalance).toBe(seen.runningBalance);

      const id = seen.refId ?? paid.expenseId ?? paid.id!;
      await as(d).post(`/expenses/${id}/cancel`, { reason: 'erreur de saisie' }).expect(200);
      expect((await balance(d, main.id)).balance).toBe(before);
    });
  });

  describe('paid at reception', () => {
    let a: RegisteredTenant;
    let cat: TenantCatalog;
    beforeAll(async () => {
      a = await registerTenant(t, 'Reception SARL');
      cat = await catalogOf(t, a);
    });

    it('creates one règlement, and the supplier balance is what it always was', async () => {
      const bank = await banque(a);
      const { draft, supplierId } = await br(a, cat, {
        paidAmount: '5000',
        paidMode: 'VIREMENT',
        paidCashAccountId: bank.id,
      });
      expect(draft.paidMode).toBe('VIREMENT');
      expect(draft.paidCashAccount?.id).toBe(bank.id);
      await as(a).post(`/purchases/${draft.id}/validate`, {}).expect(200);
      expect(await supplierBalance(a, supplierId)).toBe('6900.00');

      const rgf = await read<{ id: string; number: string; mode: string; warehouseId: string }[]>`
        SELECT id, number, mode, "warehouseId" FROM supplier_payments
        WHERE "purchaseId" = ${draft.id}::uuid`;
      expect(rgf).toHaveLength(1);
      expect(rgf[0]!.number).toMatch(/^RGF-/);
      expect(rgf[0]!.mode).toBe('VIREMENT');
      expect(rgf[0]!.warehouseId).not.toBeNull();

      const ledger = await read<
        { type: string; amount: string; refType: string; reason: string }[]
      >`
        SELECT type, amount::text, "refType", reason FROM supplier_ledger_entries
        WHERE "supplierId" = ${supplierId}::uuid AND type = 'PAYMENT'`;
      expect(ledger).toEqual([
        {
          type: 'PAYMENT',
          amount: '-5000.00',
          refType: 'SupplierPayment',
          reason: 'paid_at_reception',
        },
      ]);
      expect((await balance(a, bank.id)).balance).toBe('-5000.00');
    });

    it('defaults to cash when the form says nothing', async () => {
      const main = await caisse(a);
      const { draft } = await br(a, cat, { paidAmount: '100' });
      await as(a).post(`/purchases/${draft.id}/validate`, {}).expect(200);
      const out = (await movements(a, main.id)).items[0]!;
      expect(out).toMatchObject({ type: 'SUPPLIER_PAYMENT', amount: '-100.00' });
    });

    it('a BR with nothing paid writes no règlement', async () => {
      const { draft } = await br(a, cat);
      await as(a).post(`/purchases/${draft.id}/validate`, {}).expect(200);
      const rgf = await read<unknown[]>`
        SELECT id FROM supplier_payments WHERE "purchaseId" = ${draft.id}::uuid`;
      expect(rgf).toHaveLength(0);
    });

    it('cancelling the BR takes the règlement with it: supplier at zero, money back', async () => {
      const main = await caisse(a);
      const before = (await balance(a, main.id)).balance;
      const { draft, supplierId } = await br(a, cat, { paidAmount: '2000' });
      await as(a).post(`/purchases/${draft.id}/validate`, {}).expect(200);
      await as(a).post(`/purchases/${draft.id}/cancel`, {}).expect(200);
      expect(await supplierBalance(a, supplierId)).toBe('0.00');
      expect((await balance(a, main.id)).balance).toBe(before);
      const [rgf] = await read<{ status: string }[]>`
        SELECT status FROM supplier_payments WHERE "purchaseId" = ${draft.id}::uuid`;
      expect(rgf!.status).toBe('CANCELLED');
    });

    it('its règlement cannot be cancelled alone', async () => {
      const { draft } = await br(a, cat, { paidAmount: '50' });
      await as(a).post(`/purchases/${draft.id}/validate`, {}).expect(200);
      const [rgf] = await read<{ id: string }[]>`
        SELECT id FROM supplier_payments WHERE "purchaseId" = ${draft.id}::uuid`;
      const res = await as(a)
        .post(`/supplier-payments/${rgf!.id}/cancel`, { reason: 'erreur' })
        .expect(409);
      expect((res.body as ApiError).code).toBe(ErrorCode.SUPPLIER_PAYMENT_LINKED_TO_PURCHASE);
    });
  });

  describe('import costs', () => {
    let imp: RegisteredTenant;
    let file: ImportFileDto;
    beforeAll(async () => {
      imp = await registerTenant(t, 'Import SARL', { activity: Activity.IMPORTATEUR });
      // The overview is a MULTI_UNIT screen, which the Import edition does not carry.
      await tamper(t)`
        UPDATE tenants SET "featureGrants" = ARRAY['MULTI_UNIT'] WHERE id = ${imp.tenantId}::uuid`;
      t.app.get(FeaturesService).invalidate(imp.tenantId);
      file = (
        await as(imp).post('/import-files', { reference: 'BL-1', containerNo: 'MSKU1' }).expect(201)
      ).body as ImportFileDto;
    });

    const overview = async () =>
      (await as(imp).get(`/reports/overview?from=${TODAY}&to=${TODAY}`).expect(200))
        .body as OverviewDto;

    it('paid now is money out and never a charge; its cancel reverses it', async () => {
      const main = await caisse(imp);
      const after = (
        await as(imp)
          .post(`/import-files/${file.id}/costs`, { type: 'DOUANE', amount: '8000', paid: true })
          .expect(201)
      ).body as ImportFileDto;
      const cost = after.costs[0]!;
      expect(cost.paidFrom?.id).toBe(main.id);
      expect(cost.mode).toBe('ESPECES');
      const out = (await movements(imp, main.id)).items[0]!;
      expect(out).toMatchObject({ type: 'IMPORT_COST', amount: '-8000.00', refType: 'ImportCost' });

      const o = await overview();
      expect(o.total.cashOut.importCosts).toBe('8000.00');
      expect(o.total.cashOut.total).toBe('8000.00');
      expect(o.total.netCash).toBe('-8000.00');
      const charges = (await as(imp).get(`/reports/charges?from=${TODAY}&to=${TODAY}`).expect(200))
        .body as ChargesReportDto;
      expect(charges.total).toBe('0.00');
      const dep = await read<unknown[]>`
        SELECT id FROM expenses WHERE "tenantId" = ${imp.tenantId}::uuid`;
      expect(dep).toHaveLength(0);

      await as(imp)
        .post(`/import-files/${file.id}/costs/${cost.id}/cancel`, { reason: 'erreur' })
        .expect(200);
      expect((await balance(imp, main.id)).balance).toBe('0.00');
      expect((await overview()).total.cashOut.importCosts).toBe('0.00');
    });

    it('a cost that is not paid moves nothing, and one with a supplier cannot be paid here', async () => {
      const main = await caisse(imp);
      const before = (await movements(imp, main.id)).items.length;
      await as(imp)
        .post(`/import-files/${file.id}/costs`, { type: 'DOUANE', amount: '100' })
        .expect(201);
      expect((await movements(imp, main.id)).items).toHaveLength(before);
      const s = await supplier(imp);
      await as(imp)
        .post(`/import-files/${file.id}/costs`, {
          type: 'FRET',
          amount: '100',
          supplierId: s.id,
          paid: true,
        })
        .expect(400);
    });

    it('cancelling the dossier reverses a cost paid now', async () => {
      const f = (
        await as(imp).post('/import-files', { reference: 'BL-2', containerNo: 'MSKU2' }).expect(201)
      ).body as ImportFileDto;
      const main = await caisse(imp);
      const before = (await balance(imp, main.id)).balance;
      await as(imp)
        .post(`/import-files/${f.id}/costs`, { type: 'DOUANE', amount: '60', paid: true })
        .expect(201);
      await as(imp).post(`/import-files/${f.id}/cancel`, { reason: 'annulé' }).expect(200);
      expect((await balance(imp, main.id)).balance).toBe(before);
    });
  });

  describe('transfers', () => {
    let a: RegisteredTenant;
    beforeAll(async () => {
      a = await registerTenant(t, 'Transferts SARL');
    });

    const transfer = (from: string, to: string, amount: string, key?: string) =>
      as(a).post(
        '/treasury/transfers',
        { fromAccountId: from, toAccountId: to, amount },
        key ?? randomUUID(),
      );

    it('moves money as two movements summing to zero, once on a replay', async () => {
      const main = await caisse(a);
      const bank = await banque(a);
      await versement(a, { amount: '1000' });
      const key = randomUUID();
      const first = await transfer(main.id, bank.id, '400', key).expect(201);
      const again = await transfer(main.id, bank.id, '400', key).expect(201);
      expect(again.body).toEqual(first.body);
      const tr = first.body as CashTransferDto;
      expect(tr.number).toMatch(/^TRF-\d{4}-000001$/);
      expect((await balance(a, main.id)).balance).toBe('600.00');
      expect((await balance(a, bank.id)).balance).toBe('400.00');
      const legs = await read<{ type: string; amount: string }[]>`
        SELECT type, amount::text FROM cash_movements
        WHERE "refType" = 'CashTransfer' AND "refId" = ${tr.id}::uuid ORDER BY amount`;
      expect(legs).toEqual([
        { type: 'TRANSFER_OUT', amount: '-400.00' },
        { type: 'TRANSFER_IN', amount: '400.00' },
      ]);
    });

    it('is neither cash in nor cash out', async () => {
      const summary = (await as(a).get('/treasury/summary').expect(200)).body as TreasurySummaryDto;
      expect(summary.totals).toMatchObject({
        caisses: '600.00',
        banques: '400.00',
        cashIn: '1000.00',
        cashOut: '0.00',
      });
    });

    it('refuses more than the account holds, and the same account twice', async () => {
      const main = await caisse(a);
      const bank = await banque(a);
      const res = await transfer(main.id, bank.id, '600.01').expect(409);
      expect((res.body as ApiError).code).toBe(ErrorCode.CASH_INSUFFICIENT);
      await transfer(main.id, main.id, '1').expect(400);
    });

    it('concurrent transfers draining one caisse never overdraw it', async () => {
      const main = await caisse(a);
      const bank = await banque(a);
      const held = Number((await balance(a, main.id)).balance);
      const results = await Promise.all(
        Array.from({ length: 6 }, () => transfer(main.id, bank.id, '250')),
      );
      const ok = results.filter((r) => r.status === 201).length;
      const refused = results.filter((r) => r.status === 409).length;
      expect(ok).toBe(Math.floor(held / 250));
      expect(ok + refused).toBe(6);
      expect(Number((await balance(a, main.id)).balance)).toBe(held - ok * 250);
      const check = (await as(a).get('/treasury/reconcile').expect(200))
        .body as TreasuryReconcileDto;
      expect(check).toEqual({ ok: true, differences: [] });
    });

    it('opposite transfers at once do not deadlock', async () => {
      const main = await caisse(a);
      const bank = await banque(a);
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          i % 2 ? transfer(main.id, bank.id, '1') : transfer(bank.id, main.id, '1'),
        ),
      );
      expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    });

    it('cancelling reverses both legs, once', async () => {
      const main = await caisse(a);
      const bank = await banque(a);
      await versement(a, { amount: '90' });
      const m = (await balance(a, main.id)).balance;
      const b = (await balance(a, bank.id)).balance;
      const tr = (await transfer(main.id, bank.id, '90').expect(201)).body as CashTransferDto;
      await as(a).post(`/treasury/transfers/${tr.id}/cancel`, { reason: 'erreur' }).expect(200);
      expect((await balance(a, main.id)).balance).toBe(m);
      expect((await balance(a, bank.id)).balance).toBe(b);
      const twice = await as(a)
        .post(`/treasury/transfers/${tr.id}/cancel`, { reason: 'encore' })
        .expect(409);
      expect((twice.body as ApiError).code).toBe(ErrorCode.CASH_TRANSFER_NOT_VALID);
    });
  });

  describe('opening balance', () => {
    let a: RegisteredTenant;
    beforeAll(async () => {
      a = await registerTenant(t, 'Ouverture SARL');
    });

    it('carries what is dated before it, and is entered once', async () => {
      const main = await caisse(a);
      const old = await expense(a, { amount: '999', date: dayBefore(10) });
      await expense(a, { amount: '10', date: dayBefore(1) });
      expect((await balance(a, main.id)).balance).toBe('-1009.00');

      await opening(a, main.id, '50000', dayBefore(5)).expect(200);
      const after = await balance(a, main.id);
      expect(after.balance).toBe('49990.00');
      expect(after.openingDate).toBe(dayBefore(5));

      const list = (await movements(a, main.id)).items;
      expect(list.find((m) => m.refId === old.id)).toMatchObject({
        counted: false,
        runningBalance: null,
      });
      expect(list.find((m) => m.type === 'OPENING')).toMatchObject({
        amount: '50000.00',
        runningBalance: '50000.00',
      });
      expect(list[0]!.runningBalance).toBe('49990.00');

      const twice = await opening(a, main.id, '1').expect(409);
      expect((twice.body as ApiError).code).toBe(ErrorCode.CASH_OPENING_ALREADY_SET);
    });

    it('a movement backdated before it does not count', async () => {
      const main = await caisse(a);
      const before = (await balance(a, main.id)).balance;
      await expense(a, { amount: '77', date: dayBefore(20) });
      expect((await balance(a, main.id)).balance).toBe(before);
    });

    it('cancelling a row older than the opening adds nothing to the count', async () => {
      const main = await caisse(a);
      const before = (await balance(a, main.id)).balance;
      const old = (await movements(a, main.id)).items.find((m) => m.amount === '-999.00')!;
      await as(a).post(`/expenses/${old.refId}/cancel`, { reason: 'erreur' }).expect(200);
      expect((await balance(a, main.id)).balance).toBe(before);
      const check = (await as(a).get('/treasury/reconcile').expect(200))
        .body as TreasuryReconcileDto;
      expect(check.ok).toBe(true);
    });

    it('a cheque older than the opening that bounces today really leaves the account', async () => {
      const bank = await banque(a);
      const c = await client(a);
      const old = dayBefore(3);
      const id = randomUUID();
      await tamper(t)`
        INSERT INTO payments (id, "tenantId", number, "clientId", amount, mode, "receivedAt",
                              "cashAccountId", "updatedAt")
        VALUES (${id}::uuid, ${a.tenantId}::uuid, 'VER-OLD-CHQ', ${c.id}::uuid, 500, 'CHEQUE',
                ${`${old}T10:00:00Z`}::timestamptz, ${bank.id}::uuid, now())`;
      await tamper(t)`
        INSERT INTO cash_movements (id, "tenantId", "cashAccountId", amount, type, "refType", "refId", date)
        VALUES (gen_random_uuid(), ${a.tenantId}::uuid, ${bank.id}::uuid, 500, 'VERSEMENT',
                'Payment', ${id}::uuid, ${old}::date)`;
      await opening(a, bank.id, '2000', TODAY).expect(200);
      expect((await balance(a, bank.id)).balance).toBe('2000.00');
      await as(a).post(`/payments/${id}/bounce`, { reason: 'impayé' }).expect(200);
      expect((await balance(a, bank.id)).balance).toBe('1500.00');
    });

    it('is the owner’s: a manager cannot enter it, and never in the future', async () => {
      const manager = await invite(a, 'MANAGER');
      const acc = await newAccount(a, {});
      await opening(manager, acc.id, '1').expect(403);
      const tomorrow = new Date(`${TODAY}T12:00:00Z`);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      await opening(a, acc.id, '1', tomorrow.toISOString().slice(0, 10)).expect(400);
    });
  });

  describe('comptage', () => {
    let a: RegisteredTenant;
    beforeAll(async () => {
      a = await registerTenant(t, 'Comptage SARL');
    });

    const count = (id: string, body: object) => as(a).post(`/cash-accounts/${id}/counts`, body);

    it('writes the écart as a movement, with a required reason', async () => {
      const main = await caisse(a);
      await versement(a, { amount: '1000' });
      const noReason = await count(main.id, { counted: '990' }).expect(400);
      expect((noReason.body as ApiError).details).toMatchObject({ field: 'reason' });
      const row = (await count(main.id, { counted: '990', reason: 'pièces' }).expect(201))
        .body as CashCountDto;
      expect(row).toMatchObject({
        expected: '1000.00',
        counted: '990.00',
        ecart: '-10.00',
        alert: false,
      });
      expect((await balance(a, main.id)).balance).toBe('990.00');
      expect((await movements(a, main.id)).items[0]).toMatchObject({
        type: 'COUNT_ADJUST',
        amount: '-10.00',
        note: 'pièces',
      });
    });

    it('a count that matches writes no movement and needs no reason', async () => {
      const main = await caisse(a);
      const before = (await movements(a, main.id)).items.length;
      const row = (await count(main.id, { counted: '990' }).expect(201)).body as CashCountDto;
      expect(row.ecart).toBe('0.00');
      expect((await movements(a, main.id)).items).toHaveLength(before);
    });

    it('alerts the owner from the tenant threshold up, and is audited', async () => {
      const main = await caisse(a);
      await as(a).patch('/tenant/settings', { cashCountAlertThreshold: '100' }).expect(200);
      const row = (await count(main.id, { counted: '1090', reason: 'billet oublié' }).expect(201))
        .body as CashCountDto;
      expect(row).toMatchObject({ ecart: '100.00', alert: true });
      const summary = (await as(a).get('/treasury/summary').expect(200)).body as TreasurySummaryDto;
      expect(summary.alerts[0]).toMatchObject({ ecart: '100.00', reason: 'billet oublié' });
      const audit = await read<{ action: string }[]>`
        SELECT action FROM audit_logs
        WHERE "tenantId" = ${a.tenantId}::uuid AND action = 'CASH_COUNTED'`;
      expect(audit.length).toBeGreaterThanOrEqual(3);
    });

    it('only a caisse is counted', async () => {
      const bank = await banque(a);
      const res = await count(bank.id, { counted: '0' }).expect(409);
      expect((res.body as ApiError).code).toBe(ErrorCode.CASH_ACCOUNT_NOT_CAISSE);
    });
  });

  describe('scope by dépôt', () => {
    let d: RegisteredTenant;
    let depotA: WarehouseDto;
    let depotB: WarehouseDto;
    let caisseA: CashAccountDto;
    let caisseB: CashAccountDto;
    let managerA: Member;
    let sellerA: Member;

    beforeAll(async () => {
      d = await registerTenant(t, 'Depots SARL', { activity: Activity.DISTRIBUTEUR });
      await withoutGeoCheck(t, d);
      depotA = (
        await as(d).post('/warehouses', { name: 'Alger', type: 'SECONDARY' }, null).expect(201)
      ).body as WarehouseDto;
      depotB = (
        await as(d).post('/warehouses', { name: 'Oran', type: 'SECONDARY' }, null).expect(201)
      ).body as WarehouseDto;
      caisseA = await newAccount(d, {
        name: 'Caisse Alger',
        type: 'CAISSE',
        warehouseId: depotA.id,
        isDefault: true,
      });
      caisseB = await newAccount(d, {
        name: 'Caisse Oran',
        type: 'CAISSE',
        warehouseId: depotB.id,
        isDefault: true,
      });
      managerA = await invite(d, 'MANAGER');
      sellerA = await invite(d, 'SELLER');
      await as(d)
        .put(`/users/${managerA.id}/access`, {
          access: [{ warehouseId: depotA.id, level: 'OPERATE' }],
        })
        .expect(200);
      await as(d)
        .put(`/users/${sellerA.id}/access`, {
          access: [{ warehouseId: depotA.id, level: 'OPERATE' }],
        })
        .expect(200);
    });

    it('a caisse needs a dépôt with MULTI_UNIT', async () => {
      await as(d).post('/cash-accounts', { name: 'Sans dépôt', type: 'CAISSE' }, null).expect(400);
    });

    it('cash goes to the caisse of the row’s dépôt', async () => {
      await versement(d, { amount: '120', warehouseId: depotA.id });
      expect((await balance(d, caisseA.id)).balance).toBe('120.00');
      expect((await balance(d, caisseB.id)).balance).toBe('0.00');
    });

    it('a manager reaches his dépôt’s caisse and the company accounts, not another dépôt', async () => {
      const seen = (await accounts(managerA)).map((a) => a.name);
      expect(seen).toContain('Caisse Alger');
      expect(seen).toContain('Banque principale');
      expect(seen).not.toContain('Caisse Oran');
      await as(managerA).get(`/cash-accounts/${caisseB.id}`).expect(404);
      await as(managerA).get(`/cash-accounts/${caisseB.id}/movements`).expect(404);
      const res = await as(managerA)
        .post('/treasury/transfers', {
          fromAccountId: caisseA.id,
          toAccountId: caisseB.id,
          amount: '1',
        })
        .expect(404);
      expect((res.body as ApiError).code).toBe(ErrorCode.CASH_ACCOUNT_NOT_FOUND);
    });

    it('a seller picks an account in his reach, sees no balance and no company account', async () => {
      const seen = await accounts(sellerA, '?pick=true');
      expect(seen.map((a) => a.name)).toEqual(['Caisse Alger']);
      expect(seen[0]!.balance).toBeNull();
      await as(sellerA).get('/treasury/summary').expect(403);
      await as(sellerA).get(`/cash-accounts/${caisseA.id}/movements`).expect(403);
      const c = await client(d);
      await as(sellerA)
        .post('/payments', {
          clientId: c.id,
          amount: '5',
          warehouseId: depotA.id,
          cashAccountId: caisseB.id,
        })
        .expect(404);
      // The default stays the company's choice: a cheque goes to the bank he cannot pick.
      await as(sellerA)
        .post('/payments', {
          clientId: c.id,
          amount: '5',
          mode: 'CHEQUE',
          reference: 'S1',
          warehouseId: depotA.id,
        })
        .expect(201);
    });

    it('the summary, the overview and the dashboard stay inside the reach', async () => {
      const s = (await as(managerA).get('/treasury/summary').expect(200))
        .body as TreasurySummaryDto;
      expect(s.accounts.map((a) => a.account.name)).not.toContain('Caisse Oran');
      expect(s.byWarehouse.map((w) => w.warehouse?.name ?? null)).toContain('Alger');

      const dash = (await as(d).get('/dashboard').expect(200)).body as DashboardDto;
      expect(dash.treasury?.caisses).toBe('120.00');
      const onB = (await as(d).get(`/dashboard?warehouseId=${depotB.id}`).expect(200))
        .body as DashboardDto;
      expect(onB.treasury).toEqual({ caisses: '0.00', banques: '0.00' });

      const o = (await as(d).get(`/reports/overview?from=${TODAY}&to=${TODAY}`).expect(200))
        .body as OverviewDto;
      const card = o.warehouses.find((w) => w.warehouse.id === depotA.id)!;
      expect(card.balances?.caisses).toBe('120.00');
      expect(o.total.balances?.banques).toBe('5.00');
      const seller = (await as(sellerA).get('/dashboard').expect(200)).body as DashboardDto;
      expect(seller.treasury).toBeNull();
    });

    it('what is paid at reception is in the overview’s cash out, for the BR’s dépôt', async () => {
      const { draft } = await br(d, await catalogOf(t, d), {
        paidAmount: '640',
        warehouseId: depotA.id,
      });
      await as(d).post(`/purchases/${draft.id}/validate`, {}).expect(200);
      const o = (await as(d).get(`/reports/overview?from=${TODAY}&to=${TODAY}`).expect(200))
        .body as OverviewDto;
      const card = o.warehouses.find((w) => w.warehouse.id === depotA.id)!;
      expect(card.cashOut.supplierPayments).toBe('640.00');
      expect(o.total.cashOut.supplierPayments).toBe('640.00');
    });
  });

  describe('safety', () => {
    let a: RegisteredTenant;
    let b: RegisteredTenant;
    beforeAll(async () => {
      a = await registerTenant(t, 'Tenant A');
      b = await registerTenant(t, 'Tenant B');
    });

    it('keeps companies apart', async () => {
      const mine = await caisse(a);
      await as(b).get(`/cash-accounts/${mine.id}`).expect(404);
      await as(b).get(`/cash-accounts/${mine.id}/movements`).expect(404);
      await opening(b, mine.id, '1').expect(404);
      await as(b).post(`/cash-accounts/${mine.id}/counts`, { counted: '0' }).expect(404);
      const other = await caisse(b);
      await as(b)
        .post('/treasury/transfers', {
          fromAccountId: other.id,
          toAccountId: mine.id,
          amount: '1',
        })
        .expect(404);
      const c = await client(b);
      await as(b)
        .post('/payments', { clientId: c.id, amount: '1', cashAccountId: mine.id })
        .expect(404);
      expect((await accounts(b)).some((x) => x.id === mine.id)).toBe(false);
    });

    it('a company without the module has no screens, and its money is still on the ledger', async () => {
      const off = await registerTenant(t, 'Sans Tresorerie');
      await tamper(t)`
        UPDATE tenants SET "featureRevokes" = ARRAY['TREASURY'] WHERE id = ${off.tenantId}::uuid`;
      t.app.get(FeaturesService).invalidate(off.tenantId);
      await as(off).get('/treasury/summary').expect(403);
      await as(off).get('/cash-accounts').expect(403);
      await versement(off, { amount: '42' });
      const rows = await read<{ amount: string }[]>`
        SELECT amount::text FROM cash_movements WHERE "tenantId" = ${off.tenantId}::uuid`;
      expect(rows).toEqual([{ amount: '42.00' }]);
      expect(
        ((await as(off).get('/dashboard').expect(200)).body as DashboardDto).treasury,
      ).toBeNull();
    });

    it('the ledger is append-only', async () => {
      await versement(a, { amount: '10' });
      await expect(tamper(t)`UPDATE cash_movements SET amount = 1`).rejects.toThrow(/append-only/);
      await expect(tamper(t)`DELETE FROM cash_movements`).rejects.toThrow(/append-only/);
    });

    it('the nightly job and the endpoint find a balance that drifted', async () => {
      const main = await caisse(a);
      await tamper(t)`
        UPDATE cash_account_balances SET balance = balance + 1
        WHERE "cashAccountId" = ${main.id}::uuid`;
      const check = (await as(a).get('/treasury/reconcile').expect(200))
        .body as TreasuryReconcileDto;
      expect(check.ok).toBe(false);
      expect(check.differences[0]!.account.id).toBe(main.id);
      const run = await t.app.get(ReconcileService).run();
      expect(run.mismatches.filter((m) => m.tenantId === a.tenantId).map((m) => m.check)).toContain(
        'cash_balance_equals_ledger',
      );
      await tamper(t)`
        UPDATE cash_account_balances SET balance = balance - 1
        WHERE "cashAccountId" = ${main.id}::uuid`;
    });
  });

  describe('backfill', () => {
    let a: RegisteredTenant;
    let cat: TenantCatalog;
    beforeAll(async () => {
      a = await registerTenant(t, 'Backfill SARL');
      cat = await catalogOf(t, a);
    });

    it('links old rows, writes their movements at their date, and a second run does nothing', async () => {
      const c = await client(a);
      const s = await supplier(a);
      const cats = await categories(a);
      const old = '2026-03-10';
      await tamper(t)`
        INSERT INTO payments (id, "tenantId", number, "clientId", amount, mode, "receivedAt", "updatedAt")
        VALUES
          (gen_random_uuid(), ${a.tenantId}::uuid, 'VER-OLD-1', ${c.id}::uuid, 900, 'ESPECES', ${`${old}T10:00:00Z`}::timestamptz, now()),
          (gen_random_uuid(), ${a.tenantId}::uuid, 'VER-OLD-2', ${c.id}::uuid, 300, 'CHEQUE', ${`${old}T10:00:00Z`}::timestamptz, now())`;
      await tamper(t)`
        INSERT INTO payments (id, "tenantId", number, "clientId", amount, mode, status, "updatedAt")
        VALUES (gen_random_uuid(), ${a.tenantId}::uuid, 'VER-OLD-3', ${c.id}::uuid, 50, 'ESPECES', 'CANCELLED', now())`;
      await tamper(t)`
        INSERT INTO supplier_payments (id, "tenantId", number, "supplierId", amount, mode, "paidAt", "updatedAt")
        VALUES (gen_random_uuid(), ${a.tenantId}::uuid, 'RGF-OLD-1', ${s.id}::uuid, 200, 'ESPECES', ${`${old}T10:00:00Z`}::timestamptz, now())`;
      await tamper(t)`
        INSERT INTO expenses (id, "tenantId", number, date, "categoryId", amount, mode, "updatedAt")
        VALUES (gen_random_uuid(), ${a.tenantId}::uuid, 'DEP-OLD-1', ${old}::date, ${cats[0]!.id}::uuid, 100, 'VIREMENT', now())`;
      // A BR paid at reception before phase 34: a paid amount and no règlement.
      const { draft } = await br(a, cat);
      await as(a).post(`/purchases/${draft.id}/validate`, {}).expect(200);
      await tamper(t)`UPDATE purchases SET "paidAmount" = 1000 WHERE id = ${draft.id}::uuid`;

      const backfill = t.app.get(TreasuryBackfillService);
      const first = await backfill.run();
      expect(first.linked).toBeGreaterThanOrEqual(5);
      expect(first.movements).toBeGreaterThanOrEqual(4);
      expect(first.paidAtReception.count).toBeGreaterThanOrEqual(1);

      const main = await caisse(a);
      const bank = await banque(a);
      expect((await balance(a, main.id)).balance).toBe('700.00');
      expect((await balance(a, bank.id)).balance).toBe('200.00');
      const dated = (await movements(a, main.id)).items.map((m) => [m.type, m.date]);
      expect(dated).toEqual(
        expect.arrayContaining([
          ['VERSEMENT', old],
          ['SUPPLIER_PAYMENT', old],
        ]),
      );
      const [cancelled] = await read<{ cashAccountId: string | null }[]>`
        SELECT "cashAccountId" FROM payments
        WHERE "tenantId" = ${a.tenantId}::uuid AND number = 'VER-OLD-3'`;
      expect(cancelled!.cashAccountId).toBe(main.id);
      expect(dated).toHaveLength(2);

      const second = await backfill.run();
      expect(second).toMatchObject({ linked: 0, movements: 0 });
      expect((await balance(a, main.id)).balance).toBe('700.00');
      expect(
        ((await as(a).get('/treasury/reconcile').expect(200)).body as TreasuryReconcileDto).ok,
      ).toBe(true);
    }, 120_000);
  });
});
