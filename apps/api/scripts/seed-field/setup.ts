/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- API payloads are read loosely on purpose */
import { Api, ApiError, type Obj } from './http.js';
import { CLIENT_PREFIXES, FAMILY_NAMES, PRODUCTS, SELLER_KEYS, SELLER_TOWNS, TRUCKS, USERS } from './data.js';
import { TOWNS, pointInTown, rng } from './gps.js';
import { addDays, arr, fromCents, soft, toCents, type ClientPlan, type Ctx, type Sellable } from './util.js';

const tempPassword = (pw: string) => `${pw}Tmp1`;

// ------------------------------------------------------------------ users
export async function ensureUsers(ctx: Ctx): Promise<void> {
  const { owner } = ctx;
  const existing = arr<Obj>(await owner.get('/users', []));
  const byEmail = new Map(existing.map((u) => [String(u['email']).toLowerCase(), u]));
  for (const spec of USERS) {
    let rec = byEmail.get(spec.email);
    if (rec) owner.already('users');
    else {
      const managerId = spec.manager ? ctx.users[spec.manager]?.id : null;
      rec = await owner.write('users', 'POST', '/users/invite', {
        fullName: spec.fullName,
        email: spec.email,
        role: spec.role,
        managerId: managerId ?? null,
        mode: 'PASSWORD',
        password: tempPassword(ctx.usersPassword),
      }, undefined, { id: `dry-user-${spec.key}` }).then((r: any) => r.user ?? r);
    }
    const api = new Api(ctx.base, spec.email, ctx.usersPassword, owner.dry, owner.tally);
    ctx.users[spec.key] = { key: spec.key, id: rec!['id'] as string, api };
    if (!owner.dry) await activate(ctx, api);
  }
}

/** First login of a new user: the temp password must be changed before anything else. */
async function activate(ctx: Ctx, api: Api): Promise<void> {
  try {
    await api.login();
    return;
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) throw err;
  }
  api.setPassword(tempPassword(ctx.usersPassword));
  await api.login();
  await api.raw('POST', '/auth/password', {
    currentPassword: tempPassword(ctx.usersPassword),
    newPassword: ctx.usersPassword,
  }, undefined, true);
  api.setPassword(ctx.usersPassword);
  await api.login();
}

// ------------------------------------------------------------------ trucks and sectors
export async function ensureTrucks(ctx: Ctx): Promise<void> {
  const { owner } = ctx;
  const types = arr<Obj>(await owner.get('/vehicle-types', []));
  const typeId: Record<string, string> = {};
  for (const [code, name, activity] of [
    ['VAN', 'Camionnette vente', 'CASH_VAN'],
    ['LIV', 'Camion de livraison', 'DELIVERY'],
  ] as const) {
    const t = types.find((x) => x['code'] === code);
    if (t) {
      owner.already('vehicle types');
      typeId[code] = t['id'];
    } else {
      const r = await owner.write('vehicle types', 'POST', '/vehicle-types', { code, name, codePrefix: code, activity });
      typeId[code] = r['id'];
    }
  }
  const whs = arr<Obj>(await owner.get('/warehouses', []));
  const main = whs.find((w) => w['isDefault'] || w['type'] === 'MAIN');
  if (!main) throw new Error('The company has no main dépôt.');
  ctx.mainId = main['id'];
  for (const t of TRUCKS) {
    let wh = whs.find((w) => w['code'] === t.code);
    if (wh) owner.already('trucks');
    else {
      wh = await owner.write('trucks', 'POST', '/warehouses', {
        name: t.name,
        type: 'VEHICLE',
        code: t.code,
        vehicleTypeId: typeId[t.type],
        wilayaCode: 28,
        plateNumber: t.plate,
        capacityKg: t.type === 'VAN' ? 1500 : 5000,
      });
    }
    ctx.trucks[t.code] = wh!['id'];
    const driverId = ctx.users[t.driver]!.id;
    if (wh!['assignedUser']?.['id'] !== driverId) {
      await owner.write('truck drivers (today)', 'POST', `/warehouses/${wh!['id']}/driver`, { userId: driverId, reason: 'Démo terrain' }, `sf-drv-${t.code}-${ctx.today}`);
    } else owner.already('truck drivers (today)');
  }
}

export async function ensureSectors(ctx: Ctx): Promise<Record<string, string>> {
  const { owner } = ctx;
  const existing = arr<Obj>(await owner.get('/sectors', []));
  const out: Record<string, string> = {};
  for (const t of Object.values(TOWNS)) {
    const s = existing.find((x) => x['name'] === t.name);
    if (s) {
      owner.already('sectors');
      out[t.key] = s['id'];
    } else {
      const r = await owner.write('sectors', 'POST', '/sectors', { name: t.name, wilaya: "M'Sila", communes: [t.name] });
      out[t.key] = r['id'];
    }
  }
  return out;
}

// ------------------------------------------------------------------ clients
const TOTAL_PLAN = (() => {
  const plans: ClientPlan[] = [];
  let idx = 0;
  for (const sk of SELLER_KEYS) {
    for (const [town, count] of SELLER_TOWNS[sk]) {
      for (let i = 0; i < count; i++) {
        idx++;
        const r = rng(28_000 + idx);
        const point = idx % 10 === 7 ? null : pointInTown(TOWNS[town]!, r);
        plans.push({
          idx,
          code: `FLD-${String(idx).padStart(3, '0')}`,
          sellerKey: sk,
          town,
          point,
          debt: null,
          creditLimit: null,
        });
      }
    }
  }
  // About 40 debtors (every 4th client); the first 8 of them are over their plafond.
  let n = 0;
  for (const p of plans) {
    const r = rng(77_000 + p.idx);
    if (p.idx % 4 === 0) {
      n++;
      if (n <= 8) {
        p.creditLimit = '50000.00';
        p.debt = fromCents(BigInt(7000000 + Math.floor(r() * 4000000)));
      } else {
        p.creditLimit = '300000.00';
        p.debt = fromCents(BigInt(500000 + Math.floor(r() * 9500000)));
      }
    } else if (p.idx % 3 === 0) p.creditLimit = '200000.00';
  }
  return plans;
})();

export const clientPlans = (): ClientPlan[] => TOTAL_PLAN;

const phone = (r: () => number) => `0${['550', '661', '770', '555'][Math.floor(r() * 4)]}${String(Math.floor(r() * 1e6)).padStart(6, '0')}`;

export async function ensureClients(ctx: Ctx, sectorIds: Record<string, string>): Promise<void> {
  const { owner } = ctx;
  const found = new Map((await owner.list<Obj>('/clients?search=FLD-')).map((c) => [c['code'] as string, c]));
  for (const plan of TOTAL_PLAN) {
    let c = found.get(plan.code);
    const r = rng(5_000 + plan.idx);
    if (c) owner.already('clients');
    else {
      const prefix = CLIENT_PREFIXES[Math.floor(r() * CLIENT_PREFIXES.length)]!;
      const family = FAMILY_NAMES[Math.floor(r() * FAMILY_NAMES.length)]!;
      c = await owner.write('clients', 'POST', '/clients', {
        code: plan.code,
        name: `${prefix} ${family}`,
        type: 'PROFESSIONNEL',
        phone: phone(r),
        address: `Cité ${100 + plan.idx} logements, ${TOWNS[plan.town]!.name}`,
        wilaya: "M'Sila",
        commune: TOWNS[plan.town]!.name,
        sectorId: sectorIds[plan.town],
        assignedSellerId: ctx.users[plan.sellerKey]!.id,
        creditLimit: plan.creditLimit,
      });
    }
    const id = c!['id'] as string;
    let hasPoint = !!c!['location'];
    if (plan.point && !hasPoint) {
      await soft(ctx, `location ${plan.code}`, () =>
        owner.write('client GPS points', 'PATCH', `/clients/${id}/location`, { lat: plan.point!.lat, lng: plan.point!.lng, accuracyM: 10 }),
      );
      hasPoint = true;
    } else if (plan.point) owner.already('client GPS points');
    let balance = Number(c!['balance'] ?? 0);
    if (plan.debt && !c!['hasOpening'] && balance === 0) {
      await soft(ctx, `opening ${plan.code}`, () =>
        owner.write('client debts', 'POST', `/clients/${id}/opening-balance`, { amount: plan.debt, note: 'Démo : ancien crédit' }, `sf-open-${plan.code}`),
      );
      balance = Number(plan.debt);
    } else if (plan.debt) owner.already('client debts');
    ctx.clients.push({ ...plan, id, hasPoint, balance });
  }
}

// ------------------------------------------------------------------ products and promotions
export async function ensureProducts(ctx: Ctx): Promise<void> {
  const { owner } = ctx;
  const units = arr<Obj>(await owner.get('/units', []));
  const levels = arr<Obj>(await owner.get('/price-levels', []));
  ctx.levelIds = levels.map((l) => l['id']);
  const piece = units.find((u) => u['code'] === 'PIECE')?.['id'];
  const carton = units.find((u) => u['code'] === 'CARTON')?.['id'];
  let products = await owner.list<Obj>('/products');
  if (products.length < 30 && piece && carton) {
    const have = new Set(products.map((p) => p['reference']));
    let toAdd = 30 - products.length;
    let barcodeN = 0;
    for (const spec of PRODUCTS) {
      barcodeN++;
      if (toAdd <= 0) break;
      if (have.has(spec.ref)) {
        owner.already('products');
        continue;
      }
      const cartonCents = BigInt(spec.cartonHt) * 100n;
      const pieceCents = cartonCents / BigInt(spec.perCarton);
      const code = (n: number) => `61300${String(barcodeN).padStart(3, '0')}${n}`;
      await soft(ctx, `product ${spec.ref}`, () =>
        owner.write('products', 'POST', '/products', {
          reference: spec.ref,
          designation: spec.name,
          baseUnitId: piece,
          tvaRate: spec.tva,
          minStock: String(spec.perCarton * 5),
          units: [
            { unitId: piece, factorToBase: '1', barcode: code(1), isDefaultSale: false, isDefaultPurchase: false },
            { unitId: carton, factorToBase: String(spec.perCarton), barcode: code(2), isDefaultSale: true, isDefaultPurchase: true },
          ],
          prices: levels.slice(0, 3).flatMap((l, i) => [
            { unitId: carton, priceLevelId: l['id'], priceHt: fromCents(cartonCents - BigInt(i) * cartonCents / 20n) },
            { unitId: piece, priceLevelId: l['id'], priceHt: fromCents(pieceCents - BigInt(i) * pieceCents / 20n) },
          ]),
        }),
      );
      toAdd--;
    }
    products = await owner.list<Obj>('/products');
  } else if (products.length >= 30) owner.already('products', products.length);
  ctx.sellable = products
    .map((p): Sellable | null => {
      const u = (p['units'] as Obj[] | undefined)?.find((x) => x['isDefaultSale']);
      const price = (p['prices'] as Obj[] | undefined)?.find((x) => x['unitId'] === u?.['unitId']);
      if (!u || !price || p['active'] === false) return null;
      return {
        id: p['id'],
        ref: p['reference'],
        designation: p['designation'],
        unitId: u['unitId'],
        factorToBase: Number(u['factorToBase']),
        baseUnitId: p['baseUnitId'],
        priceHt: String(price['priceHt']),
      };
    })
    .filter((x): x is Sellable => x !== null)
    .slice(0, 30);
}

export async function ensurePromotions(ctx: Ctx): Promise<void> {
  const { owner } = ctx;
  const s = ctx.sellable;
  if (s.length < 4) return;
  const have = new Set(arr<Obj>(await owner.get('/promotions', [])).map((p) => p['name']));
  const common = { validFrom: addDays(ctx.today, -7), validTo: addDays(ctx.today, 90), active: true, priority: 10, clientScope: 'ALL' };
  const promos: Obj[] = [
    { ...common, name: 'FLD Promo huile -10 %', type: 'PERCENT_DISCOUNT', target: 'PRODUCTS', productIds: [s[0]!.id], discountPct: '10' },
    { ...common, name: 'FLD Promo épicerie -5 %', type: 'PERCENT_DISCOUNT', target: 'PRODUCTS', productIds: [s[2]!.id, s[3]!.id], discountPct: '5' },
    { ...common, name: 'FLD 10 cartons achetés = 1 offert', type: 'FREE_UNITS', buyProductId: s[6]!.id, buyUnitId: s[6]!.unitId, buyQty: '10', freeProductId: null, freeUnitId: s[6]!.unitId, freeQty: '1', repeatable: true },
  ];
  for (const p of promos) {
    if (have.has(p['name'])) owner.already('promotions');
    else await soft(ctx, String(p['name']), () => owner.write('promotions', 'POST', '/promotions', p));
  }
}

// ------------------------------------------------------------------ dépôt stock
const costOf = (s: Sellable) => fromCents((toCents(s.priceHt) * 75n) / 100n);

/** Puts enough in the main dépôt (a purchase through the API) when it runs low. */
export async function ensureStock(ctx: Ctx): Promise<Map<string, number>> {
  const { owner } = ctx;
  const levels = await owner.list<Obj>(`/stock?warehouseId=${ctx.mainId}`);
  const qty = new Map(levels.map((l) => [l['productId'] as string, Number(l['qtyBase'])]));
  const low = ctx.sellable.filter((s) => (qty.get(s.id) ?? 0) < 60 * s.factorToBase);
  if (low.length === 0) {
    owner.already('stock top-ups');
    return qty;
  }
  const suppliers = arr<Obj>(await owner.get('/suppliers?limit=100', []));
  let sup = suppliers.find((x) => x['name'] === 'FLD Distribution M\'Sila');
  if (!sup) sup = await owner.write('suppliers', 'POST', '/suppliers', { name: "FLD Distribution M'Sila", code: 'FLD-SUP', phone: '0550123456' });
  const chunks = Math.ceil(low.length / 50);
  for (let c = 0; c < chunks; c++) {
    const part = low.slice(c * 50, c * 50 + 50);
    const key = `sf-purchase-${ctx.today}-${c}`;
    const po = await owner.write('purchases', 'POST', '/purchases', {
      supplierId: sup!['id'],
      documentDate: ctx.today,
      supplierRef: `SEED-FIELD-${ctx.today}-${c + 1}`,
      warehouseId: ctx.mainId,
      note: 'Démo terrain : réapprovisionnement',
      lines: part.map((s) => ({ productId: s.id, unitId: s.unitId, qty: '150', unitCost: costOf(s) })),
    }, key);
    await owner.write('purchase validations', 'POST', `/purchases/${po['id']}/validate`, {}, `${key}-v`);
    for (const s of part) qty.set(s.id, (qty.get(s.id) ?? 0) + 150 * s.factorToBase);
  }
  return qty;
}
