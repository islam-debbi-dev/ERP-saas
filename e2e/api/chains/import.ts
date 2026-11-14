/**
 * Chain 9 (audit 02): a purchase with landed costs. A USD container goes through a dossier
 * d'importation, its costs are allocated, part of the stock is sold, then a late cost
 * arrives. Rules: docs/domain.md, "Importateur" (phase 22) and "Trésorerie" (phase 34).
 */
import { area, assert, check } from '../../lib/harness.ts';
import {
  algiersToday,
  cashAccounts,
  company,
  dbRead,
  openingStock,
  product,
  same,
  supplier,
} from '../../lib/audit.ts';
import { query } from '../../lib/db.ts';

interface Purchase {
  id: string;
  number: string | null;
  status: string;
  totalTtc: string;
}
interface ImportFile {
  id: string;
  number: string;
  status: string;
}

export async function importChain(): Promise<void> {
  area('9. Import: landed costs, close, sale, late cost');
  const c = await company('Import');
  const t = c.tenantId;
  const today = algiersToday();
  const accounts = await cashAccounts(c);
  const caisse = accounts.find((a) => a.type === 'CAISSE' && a.isDefault)!;
  const banque = accounts.find((a) => a.type === 'BANQUE' && a.isDefault)!;
  await c.owner.post(`/cash-accounts/${caisse.id}/opening`, { amount: '500000', date: today });
  await c.owner.post(`/cash-accounts/${banque.id}/opening`, { amount: '1000000', date: today });

  const usd = await supplier(c, 'Yiwu Trading', 'USD');
  const transitaire = await supplier(c, 'Transit Port Alger');
  const p = await product(c, { priceHt: '3000' });

  const file = await c.owner.post<ImportFile>('/import-files', {
    reference: 'BL-MSKU-1',
    containerNo: 'MSKU1234567',
  });
  await check('the dossier is numbered DI-YYYY-000001 and open', () => {
    assert(/^DI-\d{4}-000001$/.test(file.number), `number=${file.number}`);
    assert(file.status === 'OPEN', `status=${file.status}`);
  });

  // 100 pièces at 10 USD, bank rate 135: 1 350 DA a pièce, 135 000 DA.
  const draft = await c.owner.post<Purchase>('/purchases', {
    supplierId: usd,
    documentDate: today,
    exchangeRate: '135',
    importFileId: file.id,
    lines: [{ productId: p.id, unitId: p.unitId, qty: '100', unitCost: '10' }],
  });
  const br = await c.owner.post<Purchase>(`/purchases/${draft.id}/validate`, {});
  await check('a BR of an open dossier posts the supplier account and moves no stock', async () => {
    assert(br.status === 'IN_TRANSIT', `status=${br.status}`);
    same(await dbRead.supplierBalance(t, usd), '135000', 'USD supplier balance (DZD)');
    same((await dbRead.stock(t, p.id)) ?? '0', '0', 'stock in transit');
  });

  // Fret 27 000 DA owed to the transitaire; douane 13 500 DA paid now from the caisse.
  await c.owner.post(`/import-files/${file.id}/costs`, {
    type: 'FRET',
    supplierId: transitaire,
    amount: '27000',
    method: 'VALUE',
  });
  await c.owner.post(`/import-files/${file.id}/costs`, {
    type: 'DOUANE',
    amount: '13500',
    method: 'QUANTITY',
    paid: true,
    mode: 'ESPECES',
  });
  await check('a cost with a supplier is a debt; a cost paid now leaves the caisse', async () => {
    same(await dbRead.supplierBalance(t, transitaire), '27000', 'transitaire balance');
    same(await dbRead.cashBalance(t, caisse.id), '486500', 'caisse after the douane');
  });

  const closeKey = `a2-close-${file.id}`;
  const closed = await c.owner.post<ImportFile>(`/import-files/${file.id}/close`, {}, closeKey);
  await check('closing puts the goods in stock at the coût de revient', async () => {
    assert(closed.status === 'CLOSED', `status=${closed.status}`);
    same(await dbRead.stock(t, p.id), '100', 'stock after the close');
    // (135 000 + 27 000 + 13 500) / 100 = 1 755 DA a pièce.
    same(await dbRead.avgCost(t, p.id), '1755', 'CUMP after the close');
  });
  await check('closing twice with the same key replays and moves nothing', async () => {
    const before = await query(
      `SELECT COUNT(*)::text AS n FROM stock_movements WHERE "tenantId" = $1::uuid`,
      [t],
    );
    const again = await c.owner.send<ImportFile>(
      'POST',
      `/import-files/${file.id}/close`,
      {},
      closeKey,
    );
    assert(again.status < 300, `replay answered ${again.status} ${again.raw.slice(0, 200)}`);
    const after = await query(
      `SELECT COUNT(*)::text AS n FROM stock_movements WHERE "tenantId" = $1::uuid`,
      [t],
    );
    assert(
      before[0]!['n'] === after[0]!['n'],
      `movements went from ${before[0]!['n']} to ${after[0]!['n']}`,
    );
    same(await dbRead.stock(t, p.id), '100', 'stock after the replay');
  });

  // 40 pièces sold at the counter, 3 000 DA HT, paid in cash: 142 800 DA TTC.
  const sold = await c.owner.post<{ sale: { id: string; number: string; totalTtc: string } }>(
    '/sales/quick',
    {
      type: 'BL',
      clientId: null,
      documentDate: today,
      lines: [{ productId: p.id, unitId: p.unitId, qty: '40', unitPriceHt: '3000' }],
      paidAmount: '142800',
      paymentMode: 'ESPECES',
    },
  );
  await check('the sale leaves at the landed cost and its cash reaches the caisse', async () => {
    same(sold.sale.totalTtc, '142800', 'sale TTC');
    same(await dbRead.stock(t, p.id), '60', 'stock after the sale');
    const line = await query<{ c: string }>(
      `SELECT "unitCostBase"::text AS c FROM sale_lines WHERE "tenantId" = $1::uuid AND "saleId" = $2::uuid`,
      [t, sold.sale.id],
    );
    same(line[0]!.c, '1755', 'cost frozen on the sale line');
    same(await dbRead.cashBalance(t, caisse.id), '629300', 'caisse after the sale');
  });

  // A late transport invoice of 6 000 DA: 60 DA a pièce. 60 are on hand, 40 were sold.
  await c.owner.post(`/import-files/${file.id}/late-cost`, {
    type: 'TRANSPORT',
    supplierId: transitaire,
    amount: '6000',
    method: 'QUANTITY',
  });
  await check('a late cost moves the CUMP of what is on hand only', async () => {
    same(await dbRead.stock(t, p.id), '60', 'stock after the late cost');
    // (60 x 1 755 + 3 600) / 60 = 1 815.
    same(await dbRead.avgCost(t, p.id), '1815', 'CUMP after the late cost');
    const adj = await query<{ qty: string; delta: string }>(
      `SELECT "qtyBase"::text AS qty, "valueDelta"::text AS delta FROM stock_movements
        WHERE "tenantId" = $1::uuid AND "productId" = $2::uuid AND type = 'COST_ADJUST'`,
      [t, p.id],
    );
    assert(adj.length === 1, `COST_ADJUST rows=${adj.length}`);
    same(adj[0]!.qty, '0', 'COST_ADJUST quantity');
    same(adj[0]!.delta, '3600', 'COST_ADJUST value');
    same(await dbRead.supplierBalance(t, transitaire), '33000', 'transitaire balance');
  });
  await check(
    'the past sale keeps its cost; the share of sold units is the écart (2 400 DA)',
    async () => {
      const line = await query<{ c: string }>(
        `SELECT "unitCostBase"::text AS c FROM sale_lines WHERE "tenantId" = $1::uuid AND "saleId" = $2::uuid`,
        [t, sold.sale.id],
      );
      same(line[0]!.c, '1755', 'cost on the past sale line');
      const report = await c.owner.read<{
        rows: Record<string, unknown>[];
        totals?: Record<string, unknown>;
      }>(`/reports/margin?from=${today}&to=${today}&groupBy=product`);
      const text = JSON.stringify(report);
      const ecart = (report.totals?.['ecart'] ?? report.rows?.[0]?.['ecart']) as string | undefined;
      assert(ecart !== undefined, `no écart in the margin report: ${text.slice(0, 400)}`);
      same(ecart, '2400', 'écart de coût');
    },
  );

  // 400 USD paid by transfer at 140: 56 000 DA leave the bank, 600 USD stay due.
  await c.owner.post('/supplier-payments', {
    supplierId: usd,
    amount: '400',
    exchangeRate: '140',
    mode: 'VIREMENT',
    reference: 'SWIFT-1',
  });
  await check('a règlement in USD lowers both balances and leaves the bank in DZD', async () => {
    const s = await c.owner.read<{ balance: string; balanceCurrency: string }>(`/suppliers/${usd}`);
    same(s.balanceCurrency, '600', 'USD balance');
    same(s.balance, '79000', 'DZD balance (135 000 - 56 000, no exchange gain booked)');
    same(await dbRead.supplierLedger(t, usd), '79000', 'USD supplier ledger');
    same(await dbRead.cashBalance(t, banque.id), '944000', 'bank after the règlement');
    same(await dbRead.cashLedger(t, banque.id), '944000', 'bank ledger');
    same(await dbRead.cashLedger(t, caisse.id), '629300', 'caisse ledger');
  });
  await check('the BR got its number at validation and the dossier keeps its own', async () => {
    const rows = await query<{ number: string; status: string }>(
      `SELECT "number", status::text FROM purchases WHERE "tenantId" = $1::uuid`,
      [t],
    );
    assert(rows.length === 1 && /^BR-\d{4}-000001$/.test(rows[0]!.number), JSON.stringify(rows));
    assert(rows[0]!.status === 'VALIDATED', `BR status=${rows[0]!.status}`);
  });
  void openingStock;
}
