import { randomUUID } from 'node:crypto';
import {
  Activity,
  addDays,
  type AuthResponse,
  type ClientDto,
  type DashboardTodoDto,
  type InviteResultDto,
  type OrderDto,
  type PaymentDto,
  type PurchaseDto,
  type SaleDto,
  type SaleResultDto,
  type SupplierDto,
  type SupplierPaymentDto,
  type TodoItem,
  type UserDto,
} from '@erp/shared';
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
  withoutGeoCheck,
} from './helpers';

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Algiers' }).format(new Date());
const PASSWORD = 'Password123!';
const newPhone = (): string =>
  `0${5 + Math.floor(Math.random() * 3)}${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

type Who = { auth: { accessToken: string } };
type Staff = Who & { user: UserDto };

/** "À faire aujourd'hui" (phase 33): one test per item type, scoping and isolation. */
describe('dashboard todo', () => {
  let t: TestApp;
  /** Distribution: SALES_FORCE and TOURNEES on. */
  let d: RegisteredTenant;
  let other: RegisteredTenant;
  let cat: TenantCatalog;
  let seller: Staff;
  let storekeeper: Staff;
  let seq = 0;
  let ip = 0;

  let late: ClientDto;
  let over: ClientDto;
  let mineOver: ClientDto;
  let chequeToday: PaymentDto;
  let chequeOld: PaymentDto;
  let chequeLater: PaymentDto;
  let ownSoon: SupplierPaymentDto;
  let ownLater: SupplierPaymentDto;
  let supplier: SupplierDto;
  let soldOut: { id: string };
  let order: OrderDto;
  let oldDraft: SaleDto;
  let freshDraft: SaleDto;
  let mine: DashboardTodoDto;

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
  });

  const staff = async (role: 'SELLER' | 'STOREKEEPER'): Promise<Staff> => {
    const phone = newPhone();
    const invited = (
      await as(d)
        .post(
          '/users/invite',
          {
            fullName: `${role} ${++seq}`,
            phone,
            role,
            mode: 'PASSWORD',
            password: 'Temporary1!',
          },
          null,
        )
        .expect(201)
    ).body as InviteResultDto;
    const login = (password: string) =>
      t
        .http()
        .post('/auth/login')
        .set('X-Forwarded-For', `10.33.0.${++ip}`)
        .set('X-Client-Type', 'native')
        .send({ identifier: phone, password });
    const first = (await login('Temporary1!').expect(200)).body as AuthResponse;
    await as({ auth: first })
      .post('/auth/password', { currentPassword: 'Temporary1!', newPassword: PASSWORD }, null)
      .expect(200);
    return { auth: (await login(PASSWORD).expect(200)).body as AuthResponse, user: invited.user };
  };

  const client = async (extra: object = {}) =>
    (
      await as(d)
        .post('/clients', { code: `TD${++seq}`, name: `Client todo ${seq}`, ...extra }, null)
        .expect(201)
    ).body as ClientDto;

  /** 2 cartons at 2 300 HT on credit, `daysAgo` days back; nothing in stock before. */
  const sell = async (
    clientId: string,
    daysAgo = 0,
    product?: { id: string; cartonUnitId: string },
  ) => {
    const p = product ?? (await createProduct(t, d, cat));
    return (
      (
        await as(d)
          .post('/sales/quick', {
            documentDate: addDays(TODAY, -daysAgo),
            clientId,
            lines: [{ productId: p.id, unitId: p.cartonUnitId, qty: '2', unitPriceHt: '2300' }],
          })
          .expect(201)
      ).body as SaleResultDto
    ).sale;
  };

  const cheque = async (clientId: string, dueDate: string, amount: string) =>
    (
      await as(d)
        .post('/payments', { clientId, amount, mode: 'CHEQUE', reference: `CH${++seq}`, dueDate })
        .expect(201)
    ).body as PaymentDto;

  const todo = async (who: Who) =>
    (await as(who).get('/dashboard/todo').expect(200)).body as DashboardTodoDto;
  const find = (dto: DashboardTodoDto, key: string): TodoItem | undefined =>
    dto.items.find((i) => i.key === key);

  beforeAll(async () => {
    t = await createTestApp();
    d = await registerTenant(t, 'Distrib Todo', { activity: Activity.DISTRIBUTEUR });
    await withoutGeoCheck(t, d);
    other = await registerTenant(t, 'Autre Todo', { activity: Activity.DISTRIBUTEUR });
    await withoutGeoCheck(t, other);
    cat = await catalogOf(t, d);
    seller = await staff('SELLER');
    storekeeper = await staff('STOREKEEPER');

    // A client late beyond the 30-day term, assigned to the seller.
    late = await client({ assignedSellerId: seller.user.id, phone: '0550 11 22 33' });
    await sell(late.id, 40);
    // Two clients over their plafond: one of the company, one of the seller.
    over = await client({ phone: '0661 00 00 01' });
    mineOver = await client({ assignedSellerId: seller.user.id });
    await sell(over.id);
    await sell(mineOver.id);
    await tamper(
      t,
    )`UPDATE clients SET "creditLimit" = 100 WHERE id IN (${over.id}::uuid, ${mineOver.id}::uuid)`;

    // Client cheques: due today (an item), 10 days late (too old), tomorrow (not yet).
    chequeToday = await cheque(over.id, TODAY, '1200');
    chequeOld = await cheque(over.id, addDays(TODAY, -10), '300');
    chequeLater = await cheque(over.id, addDays(TODAY, 1), '400');

    // Own cheques: in 2 days (an item), in 5 days (not yet).
    supplier = (
      await as(d)
        .post('/suppliers', { name: `Fournisseur todo ${++seq}` }, null)
        .expect(201)
    ).body as SupplierDto;
    const ownCheque = async (dueDate: string) =>
      (
        await as(d)
          .post('/supplier-payments', {
            supplierId: supplier.id,
            amount: '800',
            mode: 'CHEQUE',
            reference: `FR${++seq}`,
            dueDate,
          })
          .expect(201)
      ).body as SupplierPaymentDto;
    ownSoon = await ownCheque(addDays(TODAY, 2));
    ownLater = await ownCheque(addDays(TODAY, 5));

    // Bought 1 carton from the supplier, sold 2: out of stock, and it sold this month.
    const p = await createProduct(t, d, cat, { designation: 'Huile 5 L' });
    soldOut = p;
    const draft = (
      await as(d)
        .post('/purchases', {
          supplierId: supplier.id,
          documentDate: TODAY,
          lines: [{ productId: p.id, unitId: p.cartonUnitId, qty: '1', unitCost: '1000' }],
        })
        .expect(201)
    ).body as PurchaseDto;
    await as(d).post(`/purchases/${draft.id}/validate`).expect(200);
    await sell(late.id, 0, p);

    // A draft order waiting for confirmation.
    order = (
      await as(d)
        .post('/orders', {
          clientId: late.id,
          lines: [{ productId: p.id, unitId: p.cartonUnitId, qty: '1', unitPriceHt: '100' }],
        })
        .expect(201)
    ).body as OrderDto;

    // The owner's drafts: one left two days ago, one from now.
    const saleDraft = async () =>
      (
        await as(d)
          .post(
            '/sales',
            {
              documentDate: TODAY,
              clientId: over.id,
              lines: [{ productId: p.id, unitId: p.cartonUnitId, qty: '1', unitPriceHt: '100' }],
            },
            null,
          )
          .expect(201)
      ).body as SaleDto;
    oldDraft = await saleDraft();
    freshDraft = await saleDraft();
    await tamper(
      t,
    )`UPDATE sales SET "createdAt" = now() - interval '2 days' WHERE id = ${oldDraft.id}::uuid`;

    mine = await todo(d);
  });
  afterAll(() => t.close());

  it('CHEQUE_DUE: a client cheque due today; not one 10 days late, not tomorrow’s', () => {
    expect(find(mine, `CHEQUE_DUE:${chequeToday.id}`)).toMatchObject({
      label: over.name,
      amount: '1200.00',
      date: TODAY,
      days: 0,
      clientId: over.id,
    });
    expect(find(mine, `CHEQUE_DUE:${chequeOld.id}`)).toBeUndefined();
    expect(find(mine, `CHEQUE_DUE:${chequeLater.id}`)).toBeUndefined();
  });

  it('SUPPLIER_CHEQUE_DUE: an own cheque due within 2 days, not in 5', () => {
    expect(find(mine, `SUPPLIER_CHEQUE_DUE:${ownSoon.id}`)).toMatchObject({
      label: supplier.name,
      amount: '800.00',
      days: 2,
      supplierId: supplier.id,
    });
    expect(find(mine, `SUPPLIER_CHEQUE_DUE:${ownLater.id}`)).toBeUndefined();
  });

  it('CLIENT_OVER_LIMIT: the balance against the plafond, with the phone to call', () => {
    // 5 474 sold − the three cheques he gave (1 200 + 300 + 400).
    expect(find(mine, `CLIENT_OVER_LIMIT:${over.id}`)).toMatchObject({
      amount: '3574.00',
      limit: '100.00',
      phone: over.phone,
      clientId: over.id,
    });
  });

  it('CLIENT_LATE: the oldest unpaid amount older than the term', () => {
    expect(find(mine, `CLIENT_LATE:${late.id}`)).toMatchObject({
      clientId: late.id,
      date: addDays(TODAY, -40),
      days: 40,
    });
  });

  it('OUT_OF_STOCK_SOLD: nothing left, sold this month, with its usual supplier', () => {
    expect(find(mine, `OUT_OF_STOCK_SOLD:${soldOut.id}`)).toMatchObject({
      label: 'Huile 5 L',
      productId: soldOut.id,
      supplierId: supplier.id,
      count: 1,
    });
  });

  it('ORDER_TO_CONFIRM and DRAFT_OLD: a waiting order; the own draft older than a day', () => {
    expect(find(mine, `ORDER_TO_CONFIRM:${order.id}`)).toMatchObject({ label: late.name });
    expect(find(mine, `DRAFT_OLD:${oldDraft.id}`)).toMatchObject({
      document: 'SALE',
      label: over.name,
      days: 2,
    });
    expect(find(mine, `DRAFT_OLD:${freshDraft.id}`)).toBeUndefined();
  });

  it('ranks by type, counts everything found and keys are stable between two calls', async () => {
    const order = [
      'CHEQUE_DUE',
      'CLIENT_OVER_LIMIT',
      'SUPPLIER_CHEQUE_DUE',
      'CLIENT_LATE',
      'OUT_OF_STOCK_SOLD',
      'ORDER_TO_CONFIRM',
      'DRAFT_OLD',
    ];
    const ranks = mine.items.map((i) => order.indexOf(i.type));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(mine.total).toBe(mine.items.length);
    expect(mine.date).toBe(TODAY);
    const again = await todo(d);
    expect(again.items.map((i) => i.key)).toEqual(mine.items.map((i) => i.key));
  });

  it('a seller only sees the items of his own clients, and no cheques or stock', async () => {
    const his = await todo(seller);
    const keys = his.items.map((i) => i.key);
    expect(keys).toContain(`CLIENT_LATE:${late.id}`);
    expect(keys).toContain(`CLIENT_OVER_LIMIT:${mineOver.id}`);
    expect(keys).not.toContain(`CLIENT_OVER_LIMIT:${over.id}`);
    expect(his.items.some((i) => i.type === 'CHEQUE_DUE')).toBe(false);
    expect(his.items.some((i) => i.type === 'SUPPLIER_CHEQUE_DUE')).toBe(false);
    expect(his.items.some((i) => i.type === 'OUT_OF_STOCK_SOLD')).toBe(false);
    // The owner's drafts are not his.
    expect(keys).not.toContain(`DRAFT_OLD:${oldDraft.id}`);
  });

  it('a storekeeper sees the stock, not the money', async () => {
    const his = await todo(storekeeper);
    expect(his.items.map((i) => i.key)).toContain(`OUT_OF_STOCK_SOLD:${soldOut.id}`);
    expect(his.items.every((i) => ['OUT_OF_STOCK_SOLD', 'DRAFT_OLD'].includes(i.type))).toBe(true);
  });

  it('tenant B never sees tenant A’s items', async () => {
    const theirs = await todo(other);
    const ids = new Set(theirs.items.map((i) => i.id));
    for (const id of [
      chequeToday.id,
      ownSoon.id,
      over.id,
      late.id,
      soldOut.id,
      order.id,
      oldDraft.id,
    ]) {
      expect(ids.has(id)).toBe(false);
    }
  });
});
