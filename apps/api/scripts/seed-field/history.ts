/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument -- API payloads are read loosely on purpose */
import type { Obj } from './http.js';
import { HANDED_CASH, SELLER_KEYS } from './data.js';
import { addDays, arr, overTtc, share, soft, toCents, type Ctx } from './util.js';

/**
 * 30 days of sales for the statistics, objectives and the assistant: 2 per vendeur per day,
 * recorded by the owner for the vendeur (`sellerId`), on the main dépôt, with a past
 * `documentDate`. Payments cannot be dated by the API, so they are paid at sale (no collector).
 */
export async function ensureHistory(ctx: Ctx): Promise<void> {
  const { owner, today } = ctx;
  if (ctx.sellable.length < 3) return;
  for (const [si, sk] of SELLER_KEYS.entries()) {
    const mine = ctx.clients.filter((c) => c.sellerKey === sk);
    if (mine.length === 0) continue;
    for (let d = 1; d <= 30; d++) {
      const day = addDays(today, -d);
      const have = await owner.get<any>(
        `/sales?sellerId=${ctx.users[sk]!.id}&from=${day}&to=${day}&warehouseId=${ctx.mainId}&limit=5`,
        { items: [] },
      );
      const n = arr(have).length;
      if (n >= 2) {
        owner.already('history sales', 2);
        continue;
      }
      for (let k = n; k < 2; k++) {
        const client = mine[(d * 2 + k + si) % mine.length]!;
        const pick = (j: number) => ctx.sellable[(d + k * 5 + j * 3 + si) % ctx.sellable.length]!;
        let ht = 0n;
        const lines = [0, 1, 2].map((j) => {
          const s = pick(j);
          const qty = 1 + ((d + j + k) % 3);
          ht += toCents(s.priceHt) * BigInt(qty);
          return { productId: s.id, unitId: s.unitId, qty: String(qty) };
        });
        const mode = (d + k + si) % 7; // 4/7 paid in full, 2/7 in part, 1/7 on credit
        const paid = mode < 4 ? overTtc(ht) : mode < 6 ? share(ht, 50n) : '0.00';
        await soft(ctx, `history ${sk} ${day} #${k}`, () =>
          owner.write('history sales', 'POST', '/sales/quick', {
            documentDate: day, clientId: client.id, sellerId: ctx.users[sk]!.id, warehouseId: ctx.mainId,
            lines, paidAmount: paid, paymentMode: 'ESPECES',
          }, `sf-hist-${sk}-${day}-${k}`),
        );
      }
    }
  }
}

/** Yesterday closed for every vendeur with a cash difference (the expected cash of a past day is 0). */
export async function ensureClosedDays(ctx: Ctx): Promise<void> {
  const { owner, today } = ctx;
  const day = addDays(today, -1);
  const rows = arr<Obj>(await owner.get(`/seller-sessions?date=${day}`, []));
  for (const [si, sk] of SELLER_KEYS.entries()) {
    const id = ctx.users[sk]!.id;
    const row = rows.find((r) => r['seller']?.['id'] === id);
    if (row?.['session']?.['status'] === 'CLOSED') {
      owner.already('closed days (écart)');
      continue;
    }
    await soft(ctx, `closed day ${sk}`, async () => {
      const s = row?.['session'] ?? (await owner.write('sessions opened (past)', 'POST', '/seller-sessions', { sellerId: id, date: day }, `sf-psess-${sk}-${day}`));
      await owner.write('closed days (écart)', 'POST', `/seller-sessions/${s['id']}/close`, {
        handedCash: HANDED_CASH[si]!, note: 'Démo : écart de caisse',
      }, `sf-close-${sk}-${day}`);
    });
  }
}

/** This month's targets: a metric per vendeur and per team (an upsert, so safe to rerun). */
export async function ensureTargets(ctx: Ctx): Promise<void> {
  const { owner, today } = ctx;
  const period = today.slice(0, 7);
  const metrics: [string, string, string][] = [
    ['CA_HT', '1800000', '3600000'],
    ['ENCAISSEMENT', '1200000', '2400000'],
    ['VISITS', '200', '400'],
  ];
  for (const [metric, perSeller, perTeam] of metrics) {
    const have = arr<Obj>(await owner.get(`/sales-targets?period=${period}&metric=${metric}`, []));
    const known = new Set(have.map((t) => t['userId'] ?? t['teamManagerId']));
    const rows = [
      ...SELLER_KEYS.map((sk) => ({ userId: ctx.users[sk]!.id, value: perSeller })),
      ...['supA', 'supB'].map((k) => ({ teamManagerId: ctx.users[k]!.id, value: perTeam })),
    ];
    if (rows.every((r) => known.has((r as any).userId ?? (r as any).teamManagerId))) {
      owner.already('targets', rows.length);
      continue;
    }
    await soft(ctx, `targets ${metric}`, async () => {
      await owner.write('targets', 'PUT', '/sales-targets/bulk', { period, metric, rows });
      owner.tally.created['targets'] = (owner.tally.created['targets'] ?? 0) + rows.length - 1;
    });
  }
}

/** A draft count on the main dépôt (left open, not validated). */
export async function ensureInventory(ctx: Ctx, stock: Map<string, number>): Promise<void> {
  const { owner } = ctx;
  const list = await owner.list<Obj>('/inventories');
  const open = list.find((i) => i['warehouseId'] === ctx.mainId && !['VALIDATED', 'CANCELLED'].includes(i['status']));
  if (open) {
    owner.already('inventory drafts');
    return;
  }
  await soft(ctx, 'inventory', async () => {
    const inv = await owner.write('inventory drafts', 'POST', '/inventories', { warehouseId: ctx.mainId, note: 'Démo : comptage du dépôt' }, `sf-inv-${ctx.today}`);
    const lines = ctx.sellable.slice(0, 8).map((s, i) => ({
      productId: s.id,
      unitId: s.unitId,
      qty: String(Math.max(0, Math.floor((stock.get(s.id) ?? 0) / s.factorToBase) - (i % 3))),
    }));
    await owner.write('inventory lines', 'PUT', `/inventories/${inv['id']}/lines`, { lines });
  });
}
