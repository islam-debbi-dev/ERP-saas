/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- API payloads are read loosely on purpose */
import type { Obj } from './http.js';
import { NO_SALE_REASONS, SELLER_KEYS, TRUCKS, USERS } from './data.js';
import { TOWNS, farFrom, nearTo, orderByProximity, rng } from './gps.js';
import {
  addDays, arr, fromCents, geoAt, isoNow, overTtc, share, soft, toCents,
  type ClientRec, type Ctx, type Sellable,
} from './util.js';

/** The 10-14 lines loaded on a truck: deterministic, so a rerun rebuilds the same list. */
export function truckLines(ctx: Ctx, code: string): { s: Sellable; qty: number }[] {
  const r = rng(900 + TRUCKS.findIndex((t) => t.code === code));
  const n = 10 + Math.floor(r() * 5);
  const pool = [...ctx.sellable];
  const out: { s: Sellable; qty: number }[] = [];
  while (out.length < n && pool.length > 0) {
    const s = pool.splice(Math.floor(r() * pool.length), 1)[0]!;
    out.push({ s, qty: (code.startsWith('LIV') ? 8 : 4) + Math.floor(r() * 7) });
  }
  return out;
}

const sellerClients = (ctx: Ctx, sk: string) => ctx.clients.filter((c) => c.sellerKey === sk);

// ------------------------------------------------------------------ chargements
export async function ensureLoads(ctx: Ctx): Promise<void> {
  const { owner, today } = ctx;
  if (ctx.sellable.length < 12) throw new Error('Fewer than 12 sellable products: cannot build the chargements.');
  for (const t of TRUCKS) {
    const to = ctx.trucks[t.code]!;
    const done = arr<Obj>(
      await owner.get(`/stock-transfers?type=LOAD&status=VALIDATED&toWarehouseId=${to}&from=${today}&to=${today}&limit=5`, { items: [] }),
    );
    if (done.length > 0) {
      owner.already('chargements validated');
      continue;
    }
    await soft(ctx, `load ${t.code}`, async () => {
      const lines = truckLines(ctx, t.code).map(({ s, qty }) => ({ productId: s.id, unitId: s.unitId, qty: String(qty) }));
      const draft = await owner.write('chargements validated', 'POST', '/stock-transfers', {
        type: 'LOAD', fromWarehouseId: ctx.mainId, toWarehouseId: to, note: `Démo terrain ${today}`, lines,
      }, `sf-load-${t.code}-${today}`);
      await owner.write('chargement validations', 'POST', `/stock-transfers/${draft['id']}/validate`, {}, `sf-loadv-${t.code}-${today}`);
    });
  }
  // One draft for the magasinier, on VAN-1.
  const to = ctx.trucks['VAN-1']!;
  const drafts = arr<Obj>(await owner.get(`/stock-transfers?type=LOAD&status=DRAFT&toWarehouseId=${to}&limit=5`, { items: [] }));
  if (drafts.length > 0) owner.already('chargement drafts');
  else {
    await soft(ctx, 'draft load', () =>
      owner.write('chargement drafts', 'POST', '/stock-transfers', {
        type: 'LOAD', fromWarehouseId: ctx.mainId, toWarehouseId: to, note: 'Démo : chargement à valider par le magasinier',
        lines: ctx.sellable.slice(12, 20).map((s) => ({ productId: s.id, unitId: s.unitId, qty: '3' })),
      }, `sf-loaddraft-${today}`),
    );
  }
}

// ------------------------------------------------------------------ routes
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export async function ensureRoutes(ctx: Ctx): Promise<void> {
  const { owner } = ctx;
  const existing = arr<Obj>(await owner.get('/routes', []));
  const plans: { name: string; sellerKey?: string; truck?: string; clients: ClientRec[]; town: string }[] = [];
  for (const sk of SELLER_KEYS) {
    const mine = sellerClients(ctx, sk).filter((c) => c.hasPoint);
    plans.push({
      name: `FLD Tournée ${USERS.find((u) => u.key === sk)!.fullName.split(' ')[0]}`,
      sellerKey: sk,
      clients: mine.slice(0, 11),
      town: mine[0]?.town ?? 'msila',
    });
  }
  for (const [truck, sk] of [['LIV-1', 'sel1'], ['LIV-2', 'sel3']] as const) {
    const mine = sellerClients(ctx, sk).filter((c) => c.hasPoint);
    plans.push({ name: `FLD Livraison ${truck}`, truck, clients: mine.slice(11, 22), town: mine[0]?.town ?? 'msila' });
  }
  for (const p of plans) {
    const ordered = orderByProximity(
      p.clients.map((c) => ({ c, point: c.point! })),
      TOWNS[p.town]!.centre,
    ).map((x) => x.c);
    let route = existing.find((r) => r['name'] === p.name);
    if (route) owner.already('routes');
    else {
      route = await owner.write('routes', 'POST', '/routes', {
        name: p.name, weekdays: ALL_DAYS, active: true,
        ...(p.sellerKey ? { sellerId: ctx.users[p.sellerKey]!.id } : { vehicleId: ctx.trucks[p.truck!] }),
      });
    }
    const key = p.sellerKey ?? p.truck!;
    ctx.routes[key] = { id: route!['id'], clients: ordered };
    if (!route!['stopCount']) {
      await soft(ctx, `stops ${p.name}`, () =>
        owner.write('route stops', 'PUT', `/routes/${route!['id']}/stops`, { clientIds: ordered.map((c) => c.id) }),
      );
    }
  }
}

// ------------------------------------------------------------------ today (as each vendeur)
interface SaleLine { productId: string; unitId: string; qty: string }

function saleLines(ctx: Ctx, truck: string, offset: number, n: number): { lines: SaleLine[]; ht: bigint } {
  const picks = truckLines(ctx, truck).slice(offset, offset + n);
  let ht = 0n;
  const lines = picks.map(({ s }, i) => {
    const qty = 1 + (i % 2);
    ht += toCents(s.priceHt) * BigInt(qty);
    return { productId: s.id, unitId: s.unitId, qty: String(qty) };
  });
  return { lines, ht };
}

export async function runToday(ctx: Ctx): Promise<void> {
  const { owner, today } = ctx;
  for (const [si, sk] of SELLER_KEYS.entries()) {
    const user = ctx.users[sk]!;
    const spec = USERS.find((u) => u.key === sk)!;
    const route = ctx.routes[sk];
    const stops = route?.clients ?? [];
    if (stops.length < 6) {
      ctx.warnings.push(`${sk}: fewer than 6 stops, today's field data skipped`);
      continue;
    }
    // The day starts: an open session.
    await soft(ctx, `session ${sk}`, () =>
      owner.write('sessions opened (today)', 'POST', '/seller-sessions', { sellerId: user.id, date: today }, `sf-sess-${sk}-${today}`),
    );
    const r = rng(4000 + si);
    const kinds = [
      { pay: (ht: bigint) => overTtc(ht) }, // paid in full
      { pay: (ht: bigint) => share(ht, 40n) }, // paid in part
      { pay: () => '0.00' }, // on credit
    ];
    for (const [k, kind] of kinds.entries()) {
      const client = stops[k]!;
      await soft(ctx, `sale ${sk} #${k}`, async () => {
        const { lines, ht } = saleLines(ctx, spec.truck!, k * 3, 3);
        const res = await user.api.write('van sales (today)', 'POST', '/sales/quick', {
          documentDate: today, clientId: client.id, lines, paidAmount: kind.pay(ht), paymentMode: 'ESPECES',
          ...(client.point ? { geo: geoAt(nearTo(client.point, r)) } : {}),
        }, `sf-vsale-${sk}-${today}-${k}`, { sale: { id: 'dry-sale' } });
        await visit(ctx, sk, route!.id, client, { outcome: 'SALE', saleId: res['sale']?.['id'] }, `sf-vvis-${sk}-${today}-${k}`);
      });
    }
    // A far sale, flagged by the GPS check, for the first vendeur of each team.
    if (si % 2 === 0) {
      const client = stops.find((c, i) => i >= 3 && c.point);
      if (client) {
        await soft(ctx, `far sale ${sk}`, () => {
          const { lines } = saleLines(ctx, spec.truck!, 9, 1);
          return user.api.write('far sales flagged (today)', 'POST', '/sales/quick', {
            documentDate: today, clientId: client.id, lines, paidAmount: '0.00', paymentMode: 'ESPECES',
            geo: geoAt(farFrom(client.point!), 10, 'Client absent, livraison laissée au voisin'),
          }, `sf-far-${sk}-${today}`);
        });
      }
    }
    // A cheque versement on a debtor of the route (else the second stop).
    const debtor = stops.find((c) => c.debt) ?? stops[1]!;
    await soft(ctx, `cheque ${sk}`, () =>
      user.api.write('cheque versements (today)', 'POST', '/payments', {
        clientId: debtor.id, amount: fromCents(BigInt(12000 + si * 3500) * 100n), mode: 'CHEQUE',
        reference: `CH-${today.replaceAll('-', '')}-${si + 1}`, bank: ['BNA', 'BEA', 'CPA', 'BADR'][si]!,
        dueDate: addDays(today, 7 + si), note: 'Démo : chèque',
        ...(debtor.point ? { geo: geoAt(nearTo(debtor.point, r)) } : {}),
      }, `sf-chq-${sk}-${today}`),
    );
    // A visit without a sale.
    await visit(ctx, sk, route!.id, stops[5]!, { outcome: 'NO_SALE', reason: NO_SALE_REASONS[si % 4] }, `sf-nosale-${sk}-${today}`);
  }
  await requestLocationChanges(ctx);
}

async function visit(ctx: Ctx, sk: string, routeId: string, client: ClientRec, extra: Obj, key: string): Promise<void> {
  const r = rng(client.idx);
  await soft(ctx, `visit ${sk} ${client.code}`, () =>
    ctx.users[sk]!.api.write('visits (today)', 'POST', '/visits', {
      clientId: client.id, routeId, startedAt: isoNow(-25), endedAt: isoNow(-10),
      ...(client.point ? { geo: geoAt(nearTo(client.point, r)) } : {}), ...extra,
    }, key),
  );
}

/** Two location change requests left pending, from two vendeurs, on clients that have a point. */
async function requestLocationChanges(ctx: Ctx): Promise<void> {
  for (const sk of ['sel1', 'sel3']) {
    const c = sellerClients(ctx, sk).find((x) => x.hasPoint && x.point);
    if (!c) continue;
    const pending = arr<Obj>(await ctx.owner.get(`/location-requests?status=PENDING&clientId=${c.id}`, { items: [] }));
    if (pending.length > 0) {
      ctx.owner.already('location requests pending');
      continue;
    }
    await soft(ctx, `location request ${c.code}`, () =>
      ctx.users[sk]!.api.write('location requests pending', 'POST', `/clients/${c.id}/location-requests`, {
        lat: c.point!.lat + 0.003, lng: c.point!.lng + 0.002, accuracyM: 10, note: 'Le commerce a déménagé',
      }),
    );
  }
}

// ------------------------------------------------------------------ orders
export async function ensureOrders(ctx: Ctx): Promise<void> {
  const { owner, today } = ctx;
  const confirmed = arr<Obj>(await owner.get('/orders?status=CONFIRMED&limit=100', { items: [] }));
  const seed = confirmed.filter((o) => String(o['client']?.['code']).startsWith('FLD-'));
  owner.already('orders confirmed', seed.length);
  const missing = 10 - seed.length;
  if (missing <= 0) return;
  const lineSet = (n: number) =>
    ctx.sellable.slice(n % 10, (n % 10) + 3).map((s) => ({ productId: s.id, unitId: s.unitId, qty: String(2 + (n % 4)) }));
  // 5 per team: 3 go on the team's delivery truck, 2 stay to assign.
  for (let k = 0; k < missing; k++) {
    const livNo = k % 2 === 0 ? 1 : 2;
    const sk = livNo === 1 ? 'sel1' : 'sel3';
    const clients = ctx.routes[`LIV-${livNo}`]?.clients ?? [];
    const client = clients[(Math.floor(k / 2) + 3) % Math.max(clients.length, 1)];
    if (!client) continue;
    await soft(ctx, `order ${k}`, async () => {
      const key = `sf-order-${today}-${k}`;
      const o = await owner.write('orders confirmed', 'POST', '/orders', {
        clientId: client.id, sellerId: ctx.users[sk]!.id, requestedDate: addDays(today, 1),
        note: 'Démo terrain', lines: lineSet(k),
      }, key);
      await owner.write('order confirmations', 'POST', `/orders/${o['id']}/confirm`, {}, `${key}-c`);
      if (Math.floor(k / 2) < 3) {
        await owner.write('orders on a delivery truck', 'PATCH', `/orders/${o['id']}/livreur`, {
          deliveryVehicleId: ctx.trucks[`LIV-${livNo}`],
        });
      }
    });
  }
}
