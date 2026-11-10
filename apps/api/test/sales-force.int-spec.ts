import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import {
  Activity,
  type ApiError,
  type AuthResponse,
  type BrandDto,
  type ClientDto,
  type ClientPage,
  ErrorCode,
  type ImportPreviewDto,
  type InviteResultDto,
  type PaymentDto,
  type PaymentPage,
  type ProductDto,
  type ReportDto,
  type SaleDto,
  type SalePage,
  type SaleResultDto,
  type SectorDto,
  type TeamNodeDto,
  type UserDto,
} from '@erp/shared';
import {
  asTenant,
  bearer,
  catalogOf,
  createTestApp,
  registerTenant,
  type RegisteredTenant,
  type TenantCatalog,
  type TestApp,
  withoutGeoCheck,
} from './helpers';

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Algiers' }).format(new Date());
const PASSWORD = 'Password123!';
const errorOf = (res: { body: unknown }) => res.body as ApiError;
const newPhone = (): string =>
  `0${5 + Math.floor(Math.random() * 3)}${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

type Who = { auth: { accessToken: string } };
type Staff = Who & { user: UserDto };
type Role = 'MANAGER' | 'SELLER' | 'SUPERVISOR' | 'STOREKEEPER' | 'LIVREUR';

describe('sales force: sellers, teams, brands, sectors (phase 14)', () => {
  let t: TestApp;
  /** Distribution edition: SALES_FORCE on. */
  let d: RegisteredTenant;
  /** Essentiel edition: SALES_FORCE off. */
  let e: RegisteredTenant;
  let catD: TenantCatalog;
  let catE: TenantCatalog;
  let seq = 0;

  const ip = () => `10.14.${Math.floor(++seq / 200)}.${seq % 200}`;

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
    delete: (url: string) =>
      t
        .http()
        .delete(url)
        .set(...bearer(who.auth.accessToken)),
  });

  /** Invited with a temporary password, logged in, password changed: ready to work. */
  const staff = async (owner: RegisteredTenant, role: Role, managerId?: string): Promise<Staff> => {
    const phone = newPhone();
    const invited = (
      await as(owner)
        .post(
          '/users/invite',
          {
            fullName: `${role} ${++seq}`,
            phone,
            role,
            mode: 'PASSWORD',
            password: 'Temporary1!',
            ...(managerId ? { managerId } : {}),
          },
          null,
        )
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
    await as({ auth: first })
      .post('/auth/password', { currentPassword: 'Temporary1!', newPassword: PASSWORD }, null)
      .expect(200);
    const auth = (await login(PASSWORD).expect(200)).body as AuthResponse;
    return { auth, user: invited.user };
  };

  const setManager = (owner: RegisteredTenant, u: UserDto, managerId: string | null) =>
    as(owner).put(`/users/${u.id}`, {
      fullName: u.fullName,
      email: u.email ?? '',
      phone: u.phone ?? '',
      role: u.role,
      managerId,
    });

  const settings = (owner: RegisteredTenant, body: object) =>
    as(owner).patch('/tenant/settings', body).expect(200);

  /** Pièce product with prices on 3 levels, TVA 19 %, `stock` pièces in stock. */
  const product = async (
    who: RegisteredTenant,
    cat: TenantCatalog,
    opts: { brandId?: string | null; stock?: number } = {},
  ) => {
    const piece = cat.units['PIECE']!.id;
    const p = (
      await as(who)
        .post(
          '/products',
          {
            reference: `SF-${Date.now()}-${++seq}`,
            designation: `Article ${seq}`,
            baseUnitId: piece,
            tvaRate: '19',
            brandId: opts.brandId ?? null,
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
          },
          null,
        )
        .expect(201)
    ).body as ProductDto;
    const stock = opts.stock ?? 100;
    if (stock > 0) {
      await as(who)
        .post('/stock/opening', {
          lines: [{ productId: p.id, unitId: piece, qty: String(stock), unitCost: '60' }],
        })
        .expect(201);
    }
    return { id: p.id, piece };
  };

  const client = async (who: Who, extra: object = {}) =>
    (
      await as(who)
        .post('/clients', { code: `SF${++seq}`, name: `Client ${seq}`, ...extra }, null)
        .expect(201)
    ).body as ClientDto;

  /** One pièce; the client comptoir pays cash (the change is given back). */
  const quick = (
    who: Who,
    item: { id: string; piece: string },
    body: { clientId?: string; [k: string]: unknown } = {},
  ) =>
    as(who).post('/sales/quick', {
      documentDate: TODAY,
      lines: [{ productId: item.id, unitId: item.piece, qty: '1' }],
      ...(body.clientId ? {} : { paidAmount: '10000' }),
      ...body,
    });

  const reportRows = async (who: Who, groupBy: string, extra = '') =>
    (
      (
        await as(who)
          .get(`/reports/sales?from=${TODAY}&to=${TODAY}&groupBy=${groupBy}${extra}`)
          .expect(200)
      ).body as ReportDto
    ).rows;

  beforeAll(async () => {
    t = await createTestApp();
    d = await registerTenant(t, 'Distrib SARL', { activity: Activity.DISTRIBUTEUR });
    await withoutGeoCheck(t, d);
    e = await registerTenant(t, 'Grossiste SARL');
    catD = await catalogOf(t, d);
    catE = await catalogOf(t, e);
  });
  afterAll(() => t.close());

  // ---------------------------------------------------------------- brands

  describe('brands (core)', () => {
    it('CRUD with case-insensitive unique names, on products, isolated per tenant', async () => {
      const brand = (await as(e).post('/brands', { name: 'Elio' }, null).expect(201))
        .body as BrandDto;
      const dup = await as(e).post('/brands', { name: 'ELIO' }, null).expect(409);
      expect(errorOf(dup).code).toBe(ErrorCode.BRAND_NAME_TAKEN);

      const p = await product(e, catE, { brandId: brand.id, stock: 0 });
      const read = (await as(e).get(`/products/${p.id}`).expect(200)).body as ProductDto;
      expect(read).toMatchObject({ brandId: brand.id, brandName: 'Elio' });
      const filtered = (await as(e).get(`/products?brandId=${brand.id}`).expect(200)).body as {
        items: ProductDto[];
      };
      expect(filtered.items.map((x) => x.id)).toEqual([p.id]);

      // Tenant D neither sees it nor can put it on a product.
      const listD = (await as(d).get('/brands').expect(200)).body as BrandDto[];
      expect(listD.some((b) => b.id === brand.id)).toBe(false);
      await as(d).patch(`/brands/${brand.id}`, { name: 'Volé' }).expect(404);
      await as(d)
        .post(
          '/products',
          {
            reference: `X-${++seq}`,
            designation: 'X',
            baseUnitId: catD.units['PIECE']!.id,
            tvaRate: '0',
            brandId: brand.id,
            units: [
              {
                unitId: catD.units['PIECE']!.id,
                factorToBase: '1',
                barcode: null,
                isDefaultSale: true,
                isDefaultPurchase: true,
              },
            ],
            prices: [],
          },
          null,
        )
        .expect(400);

      // Archived: gone from the list, products keep it.
      await as(e).delete(`/brands/${brand.id}`).expect(204);
      const after = (await as(e).get('/brands').expect(200)).body as BrandDto[];
      expect(after.some((b) => b.id === brand.id)).toBe(false);
      expect(((await as(e).get(`/products/${p.id}`).expect(200)).body as ProductDto).brandId).toBe(
        brand.id,
      );
    });

    it('a seller cannot write brands', async () => {
      const seller = await staff(e, 'SELLER');
      await as(seller).post('/brands', { name: 'Interdit' }, null).expect(403);
      await as(seller).get('/brands').expect(200);
    });
  });

  // ---------------------------------------------------------------- module off

  describe('SALES_FORCE off (Essentiel)', () => {
    it('refuses sectors, bulk assign and the team tree; sellerId and the seller report work', async () => {
      const res = await as(e).get('/sectors').expect(403);
      expect(errorOf(res).code).toBe(ErrorCode.FEATURE_NOT_IN_PLAN);
      await as(e).post('/sectors', { name: 'Est' }, null).expect(403);
      const c = await client(e);
      await as(e)
        .patch('/clients/bulk-assign', { clientIds: [c.id], sectorId: null })
        .expect(403);
      await as(e).get('/users/team').expect(403);
      // Client fields of the module cannot be set either.
      const seller = await staff(e, 'SELLER');
      const refused = await as(e)
        .post(
          '/clients',
          { code: `OFF${++seq}`, name: 'X', assignedSellerId: seller.user.id },
          null,
        )
        .expect(403);
      expect(errorOf(refused).code).toBe(ErrorCode.FEATURE_NOT_IN_PLAN);

      // Core: an office user puts a seller on a sale; the report groups by it.
      const p = await product(e, catE);
      const sale = (await quick(e, p, { clientId: c.id, sellerId: seller.user.id }).expect(201))
        .body as SaleResultDto;
      expect(sale.sale.seller).toEqual({ id: seller.user.id, fullName: seller.user.fullName });
      const rows = await reportRows(e, 'seller');
      expect(rows.find((r) => r.key === seller.user.id)?.values.netTtc).toBe('119.00');
    });

    it('a seller of an Essentiel tenant still sees every client (no scoping without the module)', async () => {
      const seller = await staff(e, 'SELLER');
      const c = await client(e);
      await as(seller).get(`/clients/${c.id}`).expect(200);
    });
  });

  // ---------------------------------------------------------------- seller and collector

  describe('Sale.sellerId and Payment.collectedBy', () => {
    let seller: Staff;
    let other: Staff;
    let item: { id: string; piece: string };

    beforeAll(async () => {
      seller = await staff(d, 'SELLER');
      other = await staff(d, 'SELLER');
      item = await product(d, catD, { stock: 1000 });
    });

    it('a SELLER sells in his own name and cannot put another seller', async () => {
      const own = (await quick(seller, item).expect(201)).body as SaleResultDto;
      expect(own.sale.seller?.id).toBe(seller.user.id);
      const res = await quick(seller, item, { sellerId: other.user.id }).expect(403);
      expect(errorOf(res).code).toBe(ErrorCode.FORBIDDEN);
    });

    it('an office user picks the seller, or none; a storekeeper or deactivated user is refused', async () => {
      const picked = (await quick(d, item, { sellerId: other.user.id }).expect(201))
        .body as SaleResultDto;
      expect(picked.sale.seller?.id).toBe(other.user.id);
      const none = (await quick(d, item).expect(201)).body as SaleResultDto;
      // No seller: the creator is shown (same fallback as sales before phase 14).
      expect(none.sale.seller?.id).toBe(d.auth.user.id);
      const row = await asTenant(d.tenantId, () =>
        t.prisma.db.sale.findUniqueOrThrow({ where: { id: none.sale.id } }),
      );
      expect(row.sellerId).toBeNull();

      const keeper = await staff(d, 'STOREKEEPER');
      const res = await quick(d, item, { sellerId: keeper.user.id }).expect(422);
      expect(errorOf(res).code).toBe(ErrorCode.SELLER_NOT_ALLOWED);
    });

    it('the seller is frozen at validation: only a reassign with permission and reason changes it', async () => {
      const sale = (
        (await quick(d, item, { sellerId: seller.user.id }).expect(201)).body as SaleResultDto
      ).sale;
      // The draft route refuses a validated sale.
      await as(d)
        .put(`/sales/${sale.id}`, {
          documentDate: TODAY,
          lines: [],
          sellerId: other.user.id,
          version: sale.version,
        })
        .expect(409);

      // A seller (no SALE_REASSIGN_SELLER) is refused.
      const denied = await as(seller)
        .patch(`/sales/${sale.id}/seller`, { sellerId: seller.user.id, reason: 'erreur' })
        .expect(403);
      expect(errorOf(denied).details).toMatchObject({ permission: 'SALE_REASSIGN_SELLER' });
      // A reason is required.
      await as(d).patch(`/sales/${sale.id}/seller`, { sellerId: other.user.id }).expect(400);

      const moved = (
        await as(d)
          .patch(`/sales/${sale.id}/seller`, { sellerId: other.user.id, reason: 'mauvais vendeur' })
          .expect(200)
      ).body as SaleDto;
      expect(moved.seller?.id).toBe(other.user.id);
      const audit = await asTenant(d.tenantId, () =>
        t.prisma.db.auditLog.findFirstOrThrow({
          where: { action: 'SALE_SELLER_REASSIGNED', entityId: sale.id },
        }),
      );
      expect(audit.before).toMatchObject({ sellerId: seller.user.id });
      expect(audit.after).toMatchObject({ sellerId: other.user.id, reason: 'mauvais vendeur' });
    });

    it('a draft is not reassigned (it is edited); the edit keeps or changes the seller', async () => {
      const draft = (
        await as(d)
          .post(
            '/sales',
            {
              documentDate: TODAY,
              lines: [{ productId: item.id, unitId: item.piece, qty: '1' }],
              sellerId: seller.user.id,
            },
            null,
          )
          .expect(201)
      ).body as SaleDto;
      const res = await as(d)
        .patch(`/sales/${draft.id}/seller`, { sellerId: other.user.id, reason: 'brouillon' })
        .expect(409);
      expect(errorOf(res).code).toBe(ErrorCode.SALE_NOT_VALIDATED);
      const edited = (
        await as(d)
          .put(`/sales/${draft.id}`, {
            documentDate: TODAY,
            lines: [{ productId: item.id, unitId: item.piece, qty: '2' }],
            version: draft.version,
          })
          .expect(200)
      ).body as SaleDto;
      expect(edited.seller?.id).toBe(seller.user.id);
    });

    it('collectedBy is the receiver when he is a SELLER, none for an office user; reassign is audited', async () => {
      const c = await client(d);
      const bySeller = (
        await as(seller).post('/payments', { clientId: c.id, amount: '500' }).expect(201)
      ).body as PaymentDto;
      expect(bySeller.collectedBy?.id).toBe(seller.user.id);
      const byOffice = (
        await as(d).post('/payments', { clientId: c.id, amount: '300' }).expect(201)
      ).body as PaymentDto;
      expect(byOffice.collectedBy).toBeNull();

      // Paid at sale time by a seller: the sale's payment is collected by him.
      const paid = (
        (await quick(seller, item, { paidAmount: '119' }).expect(201)).body as SaleResultDto
      ).sale;
      const salePayment = await asTenant(d.tenantId, () =>
        t.prisma.db.payment.findFirstOrThrow({ where: { saleId: paid.id } }),
      );
      expect(salePayment.collectedBy).toBe(seller.user.id);

      await as(seller)
        .patch(`/payments/${byOffice.id}/collector`, { collectedBy: seller.user.id, reason: 'moi' })
        .expect(403);
      const moved = (
        await as(d)
          .patch(`/payments/${byOffice.id}/collector`, {
            collectedBy: other.user.id,
            reason: 'encaissé par Karim',
          })
          .expect(200)
      ).body as PaymentDto;
      expect(moved.collectedBy?.id).toBe(other.user.id);
      const audit = await asTenant(d.tenantId, () =>
        t.prisma.db.auditLog.findFirstOrThrow({
          where: { action: 'PAYMENT_COLLECTOR_REASSIGNED', entityId: byOffice.id },
        }),
      );
      expect(audit.before).toMatchObject({ collectedBy: null });
      expect(audit.after).toMatchObject({ collectedBy: other.user.id });
    });

    it('an idempotent replay of a quick sale keeps one sale with its seller', async () => {
      const key = randomUUID();
      const first = (
        await as(d)
          .post(
            '/sales/quick',
            {
              documentDate: TODAY,
              sellerId: seller.user.id,
              paidAmount: '119',
              lines: [{ productId: item.id, unitId: item.piece, qty: '1' }],
            },
            key,
          )
          .expect(201)
      ).body as SaleResultDto;
      const replay = (
        await as(d)
          .post(
            '/sales/quick',
            {
              documentDate: TODAY,
              sellerId: seller.user.id,
              paidAmount: '119',
              lines: [{ productId: item.id, unitId: item.piece, qty: '1' }],
            },
            key,
          )
          .expect(201)
      ).body as SaleResultDto;
      expect(replay.sale.id).toBe(first.sale.id);
      expect(replay.sale.seller?.id).toBe(seller.user.id);
    });
  });

  // ---------------------------------------------------------------- hierarchy

  describe('team hierarchy', () => {
    it('refuses a user as his own manager, and direct and indirect cycles (MANAGER_CYCLE)', async () => {
      const a = await staff(d, 'SUPERVISOR');
      const b = await staff(d, 'SUPERVISOR', a.user.id);
      const c = await staff(d, 'SUPERVISOR', b.user.id);

      const self = await setManager(d, a.user, a.user.id).expect(422);
      expect(errorOf(self).code).toBe(ErrorCode.MANAGER_CYCLE);
      const direct = await setManager(d, a.user, b.user.id).expect(422);
      expect(errorOf(direct).code).toBe(ErrorCode.MANAGER_CYCLE);
      const indirect = await setManager(d, a.user, c.user.id).expect(422);
      expect(errorOf(indirect).code).toBe(ErrorCode.MANAGER_CYCLE);

      // A seller cannot manage a team.
      const s = await staff(d, 'SELLER');
      await setManager(d, a.user, s.user.id).expect(400);
      // Clearing the manager is fine.
      const cleared = (await setManager(d, c.user, null).expect(200)).body as UserDto;
      expect(cleared.managerId).toBeNull();
    });

    it('two concurrent opposite edits cannot build a cycle', async () => {
      const x = await staff(d, 'SUPERVISOR');
      const y = await staff(d, 'SUPERVISOR');
      const results = await Promise.all([
        setManager(d, x.user, y.user.id),
        setManager(d, y.user, x.user.id),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
    });

    it('the team tree shows the hierarchy; a supervisor sees his own team', async () => {
      const sup = await staff(d, 'SUPERVISOR');
      const s1 = await staff(d, 'SELLER', sup.user.id);
      const tree = (await as(d).get('/users/team').expect(200)).body as TeamNodeDto[];
      const node = tree.find((n) => n.id === sup.user.id);
      expect(node?.members.map((m) => m.id)).toEqual([s1.user.id]);
      const own = (await as(sup).get('/users/team').expect(200)).body as TeamNodeDto[];
      expect(own).toHaveLength(1);
      expect(own[0]!.members.map((m) => m.id)).toEqual([s1.user.id]);
      await as(s1).get('/users/team').expect(403);
    });
  });

  // ---------------------------------------------------------------- scoping

  describe('data scoping under ASSIGNED_ONLY', () => {
    let sup: Staff;
    let s1: Staff;
    let s2: Staff;
    let outsider: Staff;
    let c1: ClientDto;
    let c2: ClientDto;
    let c3: ClientDto;
    let item: { id: string; piece: string };
    let sale2: SaleDto;
    let pay2: PaymentDto;

    beforeAll(async () => {
      sup = await staff(d, 'SUPERVISOR');
      s1 = await staff(d, 'SELLER', sup.user.id);
      s2 = await staff(d, 'SELLER', sup.user.id);
      outsider = await staff(d, 'SELLER');
      item = await product(d, catD, { stock: 1000 });
      c1 = await client(d, { assignedSellerId: s1.user.id });
      c2 = await client(d, { assignedSellerId: s2.user.id });
      c3 = await client(d, { assignedSellerId: outsider.user.id });
      sale2 = ((await quick(s2, item, { clientId: c2.id }).expect(201)).body as SaleResultDto).sale;
      pay2 = (await as(s2).post('/payments', { clientId: c2.id, amount: '50' }).expect(201))
        .body as PaymentDto;
      await quick(outsider, item, { clientId: c3.id }).expect(201);
      await settings(d, { sellerScope: 'ASSIGNED_ONLY' });
    });
    afterAll(() => settings(d, { sellerScope: 'ALL_CLIENTS' }));

    it('a SELLER sees only his clients; another seller’s client is a 404 everywhere', async () => {
      const page = (await as(s1).get('/clients?limit=100').expect(200)).body as ClientPage;
      expect(page.items.map((c) => c.id)).toEqual([c1.id]);
      for (const url of [
        `/clients/${c2.id}`,
        `/clients/${c2.id}/statement?from=${TODAY}&to=${TODAY}`,
        `/clients/${c2.id}/unpaid-documents`,
        `/clients/${c2.id}/statement/pdf?from=${TODAY}&to=${TODAY}`,
      ]) {
        const res = await as(s1).get(url).expect(404);
        expect(errorOf(res).code).toBe(ErrorCode.NOT_FOUND);
      }
      // Selling to him or taking his money is a 404 too.
      await quick(s1, item, { clientId: c2.id }).expect(404);
      await as(s1).post('/payments', { clientId: c2.id, amount: '10' }).expect(404);
      // The client comptoir stays open.
      await quick(s1, item).expect(201);
      // A new client he creates is his.
      const mine = await client(s1);
      expect(mine.assignedSeller?.id).toBe(s1.user.id);
      await as(s1).get(`/clients/${mine.id}`).expect(200);
    });

    it('a SELLER sees only his own sales and versements', async () => {
      const sales = (await as(s1).get('/sales?limit=100').expect(200)).body as SalePage;
      expect(sales.items.every((s) => s.seller?.id === s1.user.id)).toBe(true);
      await as(s1).get(`/sales/${sale2.id}`).expect(404);
      await as(s1).post(`/sales/${sale2.id}/cancel`, { reason: 'pas à moi' }).expect(404);
      await as(s1).get(`/documents/BL/${sale2.id}/pdf`).expect(404);
      const pays = (await as(s1).get('/payments?limit=100').expect(200)).body as PaymentPage;
      expect(pays.items.some((p) => p.id === pay2.id)).toBe(false);
      await as(s1).get(`/payments/${pay2.id}`).expect(404);
      const rows = await reportRows(s1, 'seller');
      expect(rows.map((r) => r.key)).toEqual([s1.user.id]);
    });

    it('a SUPERVISOR sees his whole team, not the others', async () => {
      const page = (await as(sup).get('/clients?limit=100').expect(200)).body as ClientPage;
      const ids = page.items.map((c) => c.id);
      expect(ids).toEqual(expect.arrayContaining([c1.id, c2.id]));
      expect(ids).not.toContain(c3.id);
      expect(page.items.every((c) => [s1.user.id, s2.user.id].includes(c.assignedSeller!.id))).toBe(
        true,
      );
      await as(sup).get(`/clients/${c3.id}`).expect(404);
      await as(sup).get(`/sales/${sale2.id}`).expect(200);
      await as(sup).get(`/payments/${pay2.id}`).expect(200);
      const rows = await reportRows(sup, 'seller');
      const keys = rows.map((r) => r.key);
      expect(keys).toContain(s2.user.id);
      expect(keys).not.toContain(outsider.user.id);
      // Asking for someone outside his team gives nothing, never more.
      expect(await reportRows(sup, 'seller', `&sellerId=${outsider.user.id}`)).toEqual([]);
      // The team totals.
      const teams = await reportRows(sup, 'team');
      expect(teams.map((r) => r.key)).toEqual([sup.user.id]);
    });

    it('a MANAGER and the OWNER see everything', async () => {
      const manager = await staff(d, 'MANAGER');
      for (const who of [manager, d]) {
        await as(who).get(`/clients/${c3.id}`).expect(200);
        await as(who).get(`/sales/${sale2.id}`).expect(200);
      }
      const rows = await reportRows(d, 'seller');
      expect(rows.map((r) => r.key)).toEqual(
        expect.arrayContaining([s1.user.id, s2.user.id, outsider.user.id]),
      );
      const team = await reportRows(d, 'seller', `&teamOf=${sup.user.id}`);
      expect(team.map((r) => r.key).sort()).toEqual([s1.user.id, s2.user.id].sort());
      // Phase 33: the dashboard's team filter carries over to the sales list.
      const listed = (await as(d).get(`/sales?teamOf=${sup.user.id}&limit=100`).expect(200))
        .body as SalePage;
      expect(listed.items.map((s) => s.id)).toContain(sale2.id);
      expect(listed.items.every((s) => [s1.user.id, s2.user.id].includes(s.seller?.id ?? ''))).toBe(
        true,
      );
    });

    it('a seller cannot move his client to another seller', async () => {
      const current = (await as(s1).get(`/clients/${c1.id}`).expect(200)).body as ClientDto;
      await as(s1)
        .patch(`/clients/${c1.id}`, {
          code: c1.code,
          name: c1.name,
          assignedSellerId: s2.user.id,
          version: current.version,
        })
        .expect(403);
    });
  });

  // ---------------------------------------------------------------- sectors and bulk assign

  describe('sectors and bulk assign', () => {
    it('creates sectors, assigns clients in bulk with an audit row each, reports by sector', async () => {
      const sector = (
        await as(d)
          .post(
            '/sectors',
            { name: `Est ${++seq}`, wilaya: 'Alger', communes: ['Bab Ezzouar'] },
            null,
          )
          .expect(201)
      ).body as SectorDto;
      const dup = await as(d)
        .post('/sectors', { name: sector.name.toUpperCase() }, null)
        .expect(409);
      expect(errorOf(dup).code).toBe(ErrorCode.SECTOR_NAME_TAKEN);

      const seller = await staff(d, 'SELLER');
      const cs = [await client(d), await client(d)];
      const res = (
        await as(d)
          .patch('/clients/bulk-assign', {
            clientIds: cs.map((c) => c.id),
            sectorId: sector.id,
            assignedSellerId: seller.user.id,
          })
          .expect(200)
      ).body as { updated: number };
      expect(res.updated).toBe(2);
      const read = (await as(d).get(`/clients/${cs[0]!.id}`).expect(200)).body as ClientDto;
      expect(read.sector).toEqual({ id: sector.id, name: sector.name });
      expect(read.assignedSeller?.id).toBe(seller.user.id);
      const audits = await asTenant(d.tenantId, () =>
        t.prisma.db.auditLog.findMany({
          where: { action: 'CLIENT_ASSIGNED', entityId: { in: cs.map((c) => c.id) } },
        }),
      );
      expect(audits).toHaveLength(2);
      expect(audits[0]!.before).toMatchObject({ sectorId: null, assignedSellerId: null });

      // Running it again changes nothing.
      const again = (
        await as(d)
          .patch('/clients/bulk-assign', { clientIds: cs.map((c) => c.id), sectorId: sector.id })
          .expect(200)
      ).body as { updated: number };
      expect(again.updated).toBe(0);

      // A seller cannot bulk assign.
      await as(seller)
        .patch('/clients/bulk-assign', { clientIds: [cs[0]!.id], sectorId: null })
        .expect(403);

      const item = await product(d, catD);
      await quick(d, item, { clientId: cs[0]!.id }).expect(201);
      const rows = await reportRows(d, 'sector');
      expect(rows.find((r) => r.key === sector.id)?.values.netTtc).toBe('119.00');
      const filtered = (await as(d).get(`/clients?sectorId=${sector.id}`).expect(200))
        .body as ClientPage;
      expect(filtered.items.map((c) => c.id).sort()).toEqual(cs.map((c) => c.id).sort());
    });

    it('refuses a client, sector or seller of another tenant', async () => {
      const foreignClient = await client(e);
      const mine = await client(d);
      const sector = (
        await as(d)
          .post('/sectors', { name: `Ouest ${++seq}` }, null)
          .expect(201)
      ).body as SectorDto;
      await as(d)
        .patch('/clients/bulk-assign', { clientIds: [foreignClient.id], sectorId: sector.id })
        .expect(404);
      await as(d).patch(`/sectors/${sector.id}`, { name: 'x' }).expect(200);
      const foreignSeller = await staff(e, 'SELLER');
      const res = await as(d)
        .patch('/clients/bulk-assign', {
          clientIds: [mine.id],
          assignedSellerId: foreignSeller.user.id,
        })
        .expect(422);
      expect(errorOf(res).code).toBe(ErrorCode.SELLER_NOT_ALLOWED);
      // Tenant E has no SALES_FORCE; even so it cannot touch D's sector.
      await as(e).patch(`/sectors/${sector.id}`, { name: 'volé' }).expect(403);
    });
  });

  // ---------------------------------------------------------------- reports by brand

  it('reports sales by brand, and the dashboard filters by brand', async () => {
    const brand = (
      await as(d)
        .post('/brands', { name: `Ifri ${++seq}` }, null)
        .expect(201)
    ).body as BrandDto;
    const branded = await product(d, catD, { brandId: brand.id });
    const plain = await product(d, catD);
    await quick(d, branded, {
      lines: [
        { productId: branded.id, unitId: branded.piece, qty: '2' },
        { productId: plain.id, unitId: plain.piece, qty: '1' },
      ],
    }).expect(201);
    const rows = await reportRows(d, 'brand', `&brandId=${brand.id}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.values).toMatchObject({ brand: brand.name, qty: '2.000', netHt: '200.00' });
    const dash = (await as(d).get(`/dashboard?brandId=${brand.id}`).expect(200)).body as {
      sales: { today: { ttc: string; count: number } };
    };
    expect(dash.sales.today).toEqual({ ttc: '238.00', count: 1 });
    // Phase 33: the sales list keeps the documents with a line of that brand only.
    const onlyPlain = (await quick(d, plain).expect(201)).body as SaleResultDto;
    const listed = (await as(d).get(`/sales?brandId=${brand.id}&limit=100`).expect(200))
      .body as SalePage;
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]!.id).not.toBe(onlyPlain.sale.id);
    // Another tenant's brand id finds nothing.
    const other = (await as(e).get(`/sales?brandId=${brand.id}`).expect(200)).body as SalePage;
    expect(other.items).toEqual([]);
  });

  // ---------------------------------------------------------------- import

  it('the product import accepts a Marque column; running it twice creates no duplicate brand', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Feuil1');
    const ref = `IMP-${++seq}`;
    ws.addRow(['Référence', 'Désignation', 'Marque', 'Unité', 'Prix gros', 'TVA']);
    ws.addRow([ref, 'Eau 1,5 L', 'Saïda', 'Pièce', '30', 0]);
    ws.addRow([`${ref}-B`, 'Eau 0,5 L', 'SAÏDA', 'Pièce', '20', 0]);
    const file = Buffer.from(await wb.xlsx.writeBuffer());

    const run = async () => {
      const preview = (
        await t
          .http()
          .post('/imports/PRODUCTS/preview')
          .set(...bearer(e.auth.accessToken))
          .attach('file', file, 'produits.xlsx')
          .expect(200)
      ).body as ImportPreviewDto;
      await t
        .http()
        .post(`/imports/${preview.jobId}/confirm`)
        .set(...bearer(e.auth.accessToken))
        .set('Idempotency-Key', randomUUID())
        .expect(200);
    };
    await run();
    await run();
    const brands = await asTenant(e.tenantId, () =>
      t.prisma.db.brand.findMany({ where: { name: { equals: 'saïda', mode: 'insensitive' } } }),
    );
    expect(brands).toHaveLength(1);
    const products = await asTenant(e.tenantId, () =>
      t.prisma.db.product.findMany({ where: { reference: { startsWith: ref } } }),
    );
    expect(products).toHaveLength(2);
    expect(products.every((p) => p.brandId === brands[0]!.id)).toBe(true);
  });
});
