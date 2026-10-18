import * as argon2 from 'argon2';
import {
  type AuthResponse,
  type CategoryDto,
  ErrorCode,
  type PriceLevelDto,
  type ProductDto,
  type ProductPage,
  type UnitDto,
} from '@erp/shared';
import {
  asTenant,
  bearer,
  createTestApp,
  registerTenant,
  type RegisteredTenant,
  type TestApp,
  uniqueEmail,
} from './helpers';

let barcodeSeq = 0;
/** Unique barcode per call; the same value can be reused across tenants on purpose. */
const nextBarcode = () => `613${Date.now()}${barcodeSeq++}`;

interface Catalog {
  units: Record<string, UnitDto>;
  levels: PriceLevelDto[];
}

describe('catalog', () => {
  let t: TestApp;
  let a: RegisteredTenant;
  let b: RegisteredTenant;
  let catA: Catalog;
  let catB: Catalog;

  const as = (who: RegisteredTenant) => ({
    get: (url: string) =>
      t
        .http()
        .get(url)
        .set(...bearer(who.auth.accessToken)),
    post: (url: string, body?: object) =>
      t
        .http()
        .post(url)
        .set(...bearer(who.auth.accessToken))
        .send(body ?? {}),
    patch: (url: string, body: object) =>
      t
        .http()
        .patch(url)
        .set(...bearer(who.auth.accessToken))
        .send(body),
    del: (url: string) =>
      t
        .http()
        .delete(url)
        .set(...bearer(who.auth.accessToken)),
  });

  async function catalogOf(who: RegisteredTenant): Promise<Catalog> {
    const units = (await as(who).get('/units').expect(200)).body as UnitDto[];
    const levels = (await as(who).get('/price-levels').expect(200)).body as PriceLevelDto[];
    return { units: Object.fromEntries(units.map((u) => [u.code, u])), levels };
  }

  interface UnitIn {
    unitId: string;
    factorToBase: string;
    barcode: string | null;
    isDefaultSale: boolean;
    isDefaultPurchase: boolean;
  }
  interface PriceIn {
    unitId: string;
    priceLevelId: string;
    priceHt: string;
  }
  interface ProductIn {
    reference: string;
    designation: string;
    baseUnitId: string;
    tvaRate: string;
    minStock: string;
    categoryId?: string;
    units: UnitIn[];
    prices: PriceIn[];
  }

  /** Pièce + carton of 24, prices at all 3 levels for both units. */
  function productBody(c: Catalog, overrides: Partial<ProductIn> = {}): ProductIn {
    const piece = c.units['PIECE']!.id;
    const carton = c.units['CARTON']!.id;
    return {
      reference: `REF-${Date.now()}-${barcodeSeq++}`,
      designation: 'Huile Elio 5 L',
      baseUnitId: piece,
      tvaRate: '19',
      minStock: '10',
      units: [
        {
          unitId: piece,
          factorToBase: '1',
          barcode: nextBarcode(),
          isDefaultSale: true,
          isDefaultPurchase: false,
        },
        {
          unitId: carton,
          factorToBase: '24',
          barcode: nextBarcode(),
          isDefaultSale: false,
          isDefaultPurchase: true,
        },
      ],
      prices: c.levels.flatMap((level, i) => [
        { unitId: piece, priceLevelId: level.id, priceHt: String(1300 - i * 50) },
        { unitId: carton, priceLevelId: level.id, priceHt: String(30000 - i * 1000) },
      ]),
      ...overrides,
    };
  }

  beforeAll(async () => {
    t = await createTestApp();
    a = await registerTenant(t, 'Catalog A');
    b = await registerTenant(t, 'Catalog B');
    catA = await catalogOf(a);
    catB = await catalogOf(b);
  });
  afterAll(() => t.close());

  it('a new tenant gets the default units and 3 price levels', () => {
    expect(Object.keys(catA.units).sort()).toEqual([
      'BOITE',
      'CARTON',
      'FARDEAU',
      'KG',
      'LITRE',
      'METRE',
      'PAQUET',
      'PIECE',
      'SAC',
    ]);
    expect(catA.units['KG']!.allowsDecimal).toBe(true);
    expect(catA.units['PIECE']!.allowsDecimal).toBe(false);
    expect(catA.levels.map((l) => l.name)).toEqual(['Gros', 'Demi-gros', 'Détail']);
    expect(catA.units['PIECE']!.id).not.toBe(catB.units['PIECE']!.id);
  });

  it('creates a product with 2 units and 3 price levels in one call', async () => {
    const res = await as(a).post('/products', productBody(catA)).expect(201);
    const p = res.body as ProductDto;
    expect(p.units).toHaveLength(2);
    expect(p.prices).toHaveLength(6);
    expect(p.version).toBe(1);
    expect(p.tvaRate).toBe('19.00');
    expect(p.minStock).toBe('10.000');
    expect(p.units.find((u) => u.unitCode === 'CARTON')?.factorToBase).toBe('24.000');

    const logs = await asTenant(a.tenantId, () =>
      t.prisma.db.auditLog.count({ where: { action: 'PRODUCT_CREATED', entityId: p.id } }),
    );
    expect(logs).toBe(1);
  });

  it('a duplicate barcode in the same tenant is refused; another tenant may use it', async () => {
    const body = productBody(catA);
    await as(a).post('/products', body).expect(201);
    const dupBarcode = body.units[1]!.barcode;

    const clash = productBody(catA);
    clash.units[0]!.barcode = dupBarcode;
    const res = await as(a).post('/products', clash).expect(409);
    expect(res.body).toMatchObject({ code: ErrorCode.BARCODE_ALREADY_USED });

    const other = productBody(catB);
    other.units[0]!.barcode = dupBarcode;
    await as(b).post('/products', other).expect(201);
  });

  it('two concurrent creates with the same barcode: exactly one wins', async () => {
    const shared = nextBarcode();
    const bodies = [productBody(catA), productBody(catA)];
    for (const body of bodies) body.units[0]!.barcode = shared;
    const results = await Promise.all(bodies.map((body) => as(a).post('/products', body)));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it('a duplicate reference is refused', async () => {
    const body = productBody(catA);
    await as(a).post('/products', body).expect(201);
    const res = await as(a)
      .post('/products', { ...productBody(catA), reference: body.reference })
      .expect(409);
    expect(res.body).toMatchObject({ code: ErrorCode.REFERENCE_ALREADY_USED });
  });

  it('refuses a non-whole factor for a counted product and units of another tenant', async () => {
    const half = productBody(catA);
    half.units[1]!.factorToBase = '2.5';
    const res = await as(a).post('/products', half).expect(400);
    expect(res.body).toMatchObject({
      code: ErrorCode.INVALID_PRODUCT_UNITS,
      details: { rule: 'whole_factor_required' },
    });

    const foreign = productBody(catA, { baseUnitId: catB.units['PIECE']!.id });
    foreign.units[0]!.unitId = catB.units['PIECE']!.id;
    foreign.prices.forEach((p) => {
      if (p.unitId === catA.units['PIECE']!.id) p.unitId = catB.units['PIECE']!.id;
    });
    const res2 = await as(a).post('/products', foreign).expect(400);
    expect(res2.body).toMatchObject({ code: ErrorCode.INVALID_PRODUCT_UNITS });
  });

  it('allows decimal factors for weight products', async () => {
    const kg = catA.units['KG']!.id;
    const sac = catA.units['SAC']!.id;
    await as(a)
      .post('/products', {
        reference: `SUCRE-${Date.now()}`,
        designation: 'Sucre en vrac',
        baseUnitId: kg,
        tvaRate: '9',
        minStock: '12.5',
        units: [
          { unitId: kg, factorToBase: '1', barcode: null, isDefaultSale: true },
          { unitId: sac, factorToBase: '25', barcode: nextBarcode(), isDefaultPurchase: true },
        ],
      })
      .expect(201);
  });

  it('isolates tenants on read, barcode lookup and update', async () => {
    const created = (await as(a).post('/products', productBody(catA)).expect(201))
      .body as ProductDto;
    const barcode = created.units[0]!.barcode!;

    await as(b).get(`/products/${created.id}`).expect(404);
    await as(b).get(`/products/by-barcode/${barcode}`).expect(404);
    await as(b)
      .patch(`/products/${created.id}`, { ...productBody(catB), version: 1 })
      .expect(404);
    const list = (await as(b).get(`/products?search=${created.reference}`).expect(200))
      .body as ProductPage;
    expect(list.items).toHaveLength(0);
  });

  it('finds a product by the barcode of its carton', async () => {
    const created = (await as(a).post('/products', productBody(catA)).expect(201))
      .body as ProductDto;
    const carton = created.units.find((u) => u.unitCode === 'CARTON')!;
    const res = await as(a).get(`/products/by-barcode/${carton.barcode}`).expect(200);
    expect(res.body).toMatchObject({
      product: { id: created.id },
      unit: { unitCode: 'CARTON', factorToBase: '24.000' },
    });
  });

  it('archived products leave the default search but stay findable with archived=true', async () => {
    const created = (
      await as(a)
        .post('/products', productBody(catA, { designation: 'Produit archivé' }))
        .expect(201)
    ).body as ProductDto;
    await as(a).post(`/products/${created.id}/archive`).expect(200);

    const live = (await as(a).get(`/products?search=${created.reference}`).expect(200))
      .body as ProductPage;
    expect(live.items).toHaveLength(0);
    const archived = (
      await as(a).get(`/products?archived=true&search=${created.reference}`).expect(200)
    ).body as ProductPage;
    expect(archived.items.map((p) => p.id)).toEqual([created.id]);
    // Not sellable by scan, but its barcode stays reserved.
    await as(a).get(`/products/by-barcode/${created.units[0]!.barcode}`).expect(404);
    const clash = productBody(catA);
    clash.units[0]!.barcode = created.units[0]!.barcode;
    await as(a).post('/products', clash).expect(409);

    await as(a).post(`/products/${created.id}/restore`).expect(200);
    await as(a).get(`/products/by-barcode/${created.units[0]!.barcode}`).expect(200);
  });

  it('updates prices with an audit of old and new values, and rejects a stale version', async () => {
    const created = (await as(a).post('/products', productBody(catA)).expect(201))
      .body as ProductDto;
    const body = productBody(catA, { reference: created.reference });
    body.units = created.units.map((u) => ({
      unitId: u.unitId,
      factorToBase: u.factorToBase,
      barcode: u.barcode,
      isDefaultSale: u.isDefaultSale,
      isDefaultPurchase: u.isDefaultPurchase,
    }));
    const gros = catA.levels[0]!.id;
    const piece = catA.units['PIECE']!.id;
    body.prices = created.prices.map((p) =>
      p.unitId === piece && p.priceLevelId === gros ? { ...p, priceHt: '1275.50' } : p,
    );

    const updated = (
      await as(a)
        .patch(`/products/${created.id}`, { ...body, version: 1 })
        .expect(200)
    ).body as ProductDto;
    expect(updated.version).toBe(2);
    expect(updated.prices.find((p) => p.unitId === piece && p.priceLevelId === gros)?.priceHt).toBe(
      '1275.50',
    );

    const log = await asTenant(a.tenantId, () =>
      t.prisma.db.auditLog.findFirstOrThrow({
        where: { action: 'PRODUCT_UPDATED', entityId: created.id },
      }),
    );
    expect((log.after as { priceChanges: unknown[] }).priceChanges).toEqual([
      { unitId: piece, priceLevelId: gros, from: '1300.00', to: '1275.50' },
    ]);

    const stale = await as(a)
      .patch(`/products/${created.id}`, { ...body, version: 1 })
      .expect(409);
    expect(stale.body).toMatchObject({
      code: ErrorCode.PRODUCT_MODIFIED,
      details: { currentVersion: 2 },
    });
  });

  it('removing a unit frees its barcode; swapping barcodes in one save works', async () => {
    const created = (await as(a).post('/products', productBody(catA)).expect(201))
      .body as ProductDto;
    const [piece, carton] = [
      created.units.find((u) => u.unitCode === 'PIECE')!,
      created.units.find((u) => u.unitCode === 'CARTON')!,
    ];
    const unitInput = (u: typeof piece, barcode: string | null, extra: object = {}) => ({
      unitId: u.unitId,
      factorToBase: u.factorToBase,
      barcode,
      isDefaultSale: u.isDefaultSale,
      isDefaultPurchase: u.isDefaultPurchase,
      ...extra,
    });

    // Swap the two barcodes.
    const swapped = (
      await as(a)
        .patch(`/products/${created.id}`, {
          ...productBody(catA, { reference: created.reference }),
          units: [unitInput(piece, carton.barcode), unitInput(carton, piece.barcode)],
          prices: [],
          version: 1,
        })
        .expect(200)
    ).body as ProductDto;
    expect(swapped.units.find((u) => u.unitCode === 'PIECE')?.barcode).toBe(carton.barcode);
    expect(swapped.prices).toHaveLength(0);

    // Drop the carton: its barcode (now the old pièce one) becomes free.
    await as(a)
      .patch(`/products/${created.id}`, {
        ...productBody(catA, { reference: created.reference }),
        units: [unitInput(piece, carton.barcode, { isDefaultPurchase: true })],
        prices: [],
        version: 2,
      })
      .expect(200);
    const reuse = productBody(catA);
    reuse.units[0]!.barcode = piece.barcode;
    await as(a).post('/products', reuse).expect(201);
  });

  it('refuses to change the base unit', async () => {
    const created = (await as(a).post('/products', productBody(catA)).expect(201))
      .body as ProductDto;
    const kg = catA.units['KG']!.id;
    const res = await as(a)
      .patch(`/products/${created.id}`, {
        ...productBody(catA, { reference: created.reference, baseUnitId: kg }),
        units: [
          {
            unitId: kg,
            factorToBase: '1',
            barcode: null,
            isDefaultSale: true,
            isDefaultPurchase: true,
          },
        ],
        prices: [],
        version: 1,
      })
      .expect(400);
    expect(res.body).toMatchObject({
      code: ErrorCode.INVALID_PRODUCT_UNITS,
      details: { rule: 'base_unit_immutable' },
    });
  });

  it('paginates with a cursor without duplicates or gaps', async () => {
    const c = await registerTenant(t, 'Pagination');
    const catC = await catalogOf(c);
    for (let i = 0; i < 7; i++) {
      await as(c)
        .post('/products', productBody(catC, { designation: `Article ${i}` }))
        .expect(201);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const url: string = `/products?limit=3${cursor ? `&cursor=${cursor}` : ''}`;
      const page = (await as(c).get(url).expect(200)).body as ProductPage;
      seen.push(...page.items.map((p) => p.designation));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6].map((i) => `Article ${i}`));
  });

  it('categories: one level of nesting, unique names, no delete while used, filter includes children', async () => {
    const top = (await as(a).post('/categories', { name: 'Épicerie' }).expect(201))
      .body as CategoryDto;
    const sub = (await as(a).post('/categories', { name: 'Huiles', parentId: top.id }).expect(201))
      .body as CategoryDto;

    const deep = await as(a).post('/categories', { name: 'Trop', parentId: sub.id }).expect(400);
    expect(deep.body).toMatchObject({ code: ErrorCode.CATEGORY_TOO_DEEP });
    const dup = await as(a).post('/categories', { name: 'épicerie' }).expect(409);
    expect(dup.body).toMatchObject({ code: ErrorCode.CATEGORY_NAME_TAKEN });

    const product = (
      await as(a)
        .post('/products', productBody(catA, { categoryId: sub.id }))
        .expect(201)
    ).body as ProductDto;
    const busy = await as(a).del(`/categories/${sub.id}`).expect(409);
    expect(busy.body).toMatchObject({ code: ErrorCode.CATEGORY_NOT_EMPTY });

    const filtered = (await as(a).get(`/products?categoryId=${top.id}`).expect(200))
      .body as ProductPage;
    expect(filtered.items.map((p) => p.id)).toContain(product.id);

    const tree = (await as(a).get('/categories').expect(200)).body as CategoryDto[];
    expect(tree.find((c) => c.id === top.id)?.children.map((c) => c.name)).toEqual(['Huiles']);
    // Tenant B sees none of it.
    expect((await as(b).get('/categories').expect(200)).body).toEqual([]);
  });

  it('raising priceLevelCount creates the missing levels; renaming is audited', async () => {
    const c = await registerTenant(t, 'Levels');
    await as(c).patch('/tenant/settings', { priceLevelCount: 5 }).expect(200);
    const levels = (await as(c).get('/price-levels').expect(200)).body as PriceLevelDto[];
    expect(levels.map((l) => l.position)).toEqual([1, 2, 3, 4, 5]);

    await as(c).patch(`/price-levels/${levels[3]!.id}`, { name: 'Revendeurs' }).expect(200);
    await as(c).patch('/tenant/settings', { priceLevelCount: 2 }).expect(200);
    expect(((await as(c).get('/price-levels').expect(200)).body as PriceLevelDto[]).length).toBe(2);
    await as(c).patch('/tenant/settings', { priceLevelCount: 4 }).expect(200);
    const back = (await as(c).get('/price-levels').expect(200)).body as PriceLevelDto[];
    expect(back[3]?.name).toBe('Revendeurs');
  });

  it('a SELLER can read the catalog but not change it', async () => {
    const email = uniqueEmail('seller');
    await asTenant(a.tenantId, async () =>
      t.prisma.db.user.create({
        data: {
          tenantId: a.tenantId,
          email,
          passwordHash: await argon2.hash('Password123!'),
          fullName: 'Vendeur',
          role: 'SELLER',
        },
      }),
    );
    const login = await t
      .http()
      .post('/auth/login')
      .send({ email, password: 'Password123!' })
      .expect(200);
    const seller = { ...a, auth: login.body as AuthResponse & { refreshToken: string } };
    await as(seller).get('/products').expect(200);
    const res = await as(seller).post('/products', productBody(catA)).expect(403);
    expect(res.body).toMatchObject({ code: ErrorCode.FORBIDDEN });
    await as(seller).post('/categories', { name: 'Interdit' }).expect(403);
  });
});
