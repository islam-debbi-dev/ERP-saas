/**
 * Foreign keys inside a body, for the requests the replay reached too late (the draft was
 * already validated, the dossier closed...). A fresh company (the attacker) puts ONE id of
 * another company in an otherwise valid request made on its own fresh draft.
 * Expected every time: 4xx, and nothing written (the caller checks the database after).
 */
import { assert, check } from '../../lib/harness.ts';
import { algiersToday, cashAccounts, client, company, invite, openingStock, product, supplier } from '../../lib/audit.ts';
import { draftPayroll } from '../chains/people.ts';

type V = (table: string) => string;

export async function foreignKeyChecks(victim: V): Promise<void> {
  const x = await company('Attacker');
  const o = x.owner;
  const today = algiersToday();
  const p = await product(x, { priceHt: '1000' });
  await openingStock(x, p, '100', '500');
  const cl = await client(x, 'Client attaquant');
  const sup = await supplier(x);
  const caisse = (await cashAccounts(x)).find((a) => a.type === 'CAISSE' && a.isDefault)!;
  const livreur = await invite(x, 'LIVREUR');
  const line = { productId: p.id, unitId: p.unitId, qty: '1', unitPriceHt: '1000' };

  /** The request must be refused with a 4xx; `ok` first proves the same request is valid without the foreign id. */
  const refused = async (
    name: string,
    method: 'POST' | 'PUT' | 'PATCH',
    path: string,
    body: unknown,
  ): Promise<void> => {
    await check(name, async () => {
      const res = await o.send(method, path, body, method === 'POST' ? undefined : null);
      assert(res.status >= 400 && res.status < 500, `HTTP ${res.status} ${res.raw.slice(0, 200)}`);
      assert(!/"code":"(SALE_NOT_DRAFT|PURCHASE_NOT_DRAFT|INVENTORY_CLOSED|IMPORT_FILE_NOT_OPEN|IDEMPOTENCY)/.test(res.raw), `answered by a state check, not by the id: ${res.raw.slice(0, 160)}`);
    });
  };

  // ---- sale draft
  const draft = await o.post<{ id: string; version: number }>('/sales', { type: 'BL', clientId: cl, documentDate: today, lines: [line] });
  const base = { type: 'BL', clientId: cl, documentDate: today, version: draft.version, lines: [line] };
  await refused("a draft sale cannot take another company's client", 'PUT', `/sales/${draft.id}`, { ...base, clientId: victim('clients') });
  await refused("a draft sale cannot take another company's product", 'PUT', `/sales/${draft.id}`, { ...base, lines: [{ ...line, productId: victim('products') }] });
  await refused("a draft sale cannot take another company's dépôt", 'PUT', `/sales/${draft.id}`, { ...base, warehouseId: victim('warehouses') });
  // The sale bodies have no cashAccountId (the caisse is the seller's default): nothing to forge there.
  const bl = await o.post<{ sale: { id: string } }>('/sales/quick', { type: 'BL', clientId: cl, documentDate: today, paidAmount: '0', paymentMode: 'ESPECES', lines: [line] });
  await refused("a facture cannot group another company's BL with one's own", 'POST', '/invoices/from-bls', { saleIds: [bl.sale.id, victim('sales')], documentDate: today });
  await refused("a return cannot name another company's sale line", 'POST', `/sales/${bl.sale.id}/returns`, { disposition: 'RESTOCK', reason: 'retour', lines: [{ saleLineId: victim('sale_lines'), qty: '1' }] });

  // ---- purchases, import
  const br = await o.post<{ id: string; version: number }>('/purchases', { supplierId: sup, documentDate: today, lines: [{ productId: p.id, unitId: p.unitId, qty: '5', unitCost: '400' }] });
  const brBase = { supplierId: sup, documentDate: today, version: br.version, lines: [{ productId: p.id, unitId: p.unitId, qty: '5', unitCost: '400' }] };
  await refused("a draft BR cannot take another company's supplier", 'PUT', `/purchases/${br.id}`, { ...brBase, supplierId: victim('suppliers') });
  await refused("a draft BR cannot take another company's product", 'PUT', `/purchases/${br.id}`, { ...brBase, lines: [{ ...brBase.lines[0], productId: victim('products') }] });
  await refused("a draft BR cannot join another company's import dossier", 'PUT', `/purchases/${br.id}`, { ...brBase, importFileId: victim('import_files') });
  await refused("a règlement cannot leave from another company's caisse", 'POST', '/supplier-payments', { supplierId: sup, amount: '100', mode: 'ESPECES', cashAccountId: victim('cash_accounts') });
  const dossier = await o.post<{ id: string }>('/import-files', { reference: 'ATT-1', containerNo: 'MSKU7654321' });
  await refused("an import cost cannot name another company's supplier", 'POST', `/import-files/${dossier.id}/costs`, { type: 'FRET', supplierId: victim('suppliers'), amount: '1000', method: 'VALUE' });
  await refused("another company's BR cannot be attached to one's dossier", 'POST', `/import-files/${dossier.id}/purchases`, { purchaseId: victim('purchases') });

  // ---- catalog, stock
  await refused("a brand cannot point at another company's supplier", 'POST', '/brands', { name: `Marque ${Date.now()}`, supplierId: victim('suppliers') });
  const inv = await o.post<{ id: string }>('/inventories', { note: 'attaque' });
  await refused("an inventory cannot count another company's product", 'PUT', `/inventories/${inv.id}/lines`, { lines: [{ productId: victim('products'), unitId: p.unitId, qty: '5' }] });
  const wh = await o.post<{ id: string }>('/warehouses', { name: 'Dépôt attaquant', type: 'SECONDARY', assignedUserId: null }, null);
  await refused("a dépôt cannot be limited to another company's brand", 'PUT', `/warehouses/${wh.id}/brands`, { brandIds: [victim('brands')] });
  await refused("a dépôt cannot be limited to another company's category", 'PUT', `/warehouses/${wh.id}/categories`, { categoryIds: [victim('categories')] });
  await refused("a user cannot be given access to another company's dépôt", 'PUT', `/users/${livreur.id}/access`, { access: [{ warehouseId: victim('warehouses'), level: 'OPERATE' }] });

  // ---- orders
  const order = await o.post<{ id: string; lines: { id: string }[] }>('/orders', { clientId: cl, warehouseId: x.mainWarehouseId, lines: [{ productId: p.id, unitId: p.unitId, qty: '2' }] });
  await o.post(`/orders/${order.id}/confirm`, {});
  await refused("an order cannot be given to another company's livreur", 'PATCH', `/orders/${order.id}/livreur`, { livreurId: victim('users') });
  await refused("a delivery cannot name another company's order line", 'POST', `/orders/${order.id}/deliver`, { lines: [{ orderLineId: victim('order_lines'), qty: '1' }], paidAmount: '0', paymentMode: 'ESPECES' });

  // ---- money out
  const cats = await o.read<{ items?: { id: string }[] } | { id: string }[]>('/expense-categories');
  const catId = (Array.isArray(cats) ? cats : (cats.items ?? []))[0]?.id;
  await refused("a dépense cannot leave from another company's caisse", 'POST', '/expenses', { categoryId: catId, amount: '100', date: today, mode: 'ESPECES', payee: 'X', cashAccountId: victim('cash_accounts') });
  await o.post(`/cash-accounts/${caisse.id}/opening`, { amount: '500000', date: today });

  // ---- paie
  const { run, employeeId } = await draftPayroll(x);
  await refused("a payroll draft cannot take a line for another company's employee", 'PATCH', `/payroll-runs/${run.id}`, { add: [{ kind: 'RETENUE', employeeId: victim('employees'), amount: '100', note: 'attaque' }], remove: [] });
  await refused("an avance cannot leave from another company's caisse", 'POST', `/employees/${employeeId}/advances`, { amount: '100', mode: 'ESPECES', cashAccountId: victim('cash_accounts') });
  const fresh = await o.read<{ version: number }>(`/payroll-runs/${run.id}`);
  await o.post(`/payroll-runs/${run.id}/approve`, { version: fresh.version }, null);
  await refused("salaries cannot be paid from another company's caisse", 'POST', `/payroll-runs/${run.id}/payments`, { mode: 'ESPECES', cashAccountId: victim('cash_accounts') });
  await refused("a salary payment cannot name another company's employee", 'POST', `/payroll-runs/${run.id}/payments`, { mode: 'ESPECES', items: [{ employeeId: victim('employees') }] });
}
