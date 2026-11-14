/**
 * The routes of phases 1–11 (catalog, clients, sales, payments, stock, share links, users),
 * called once each with a valid body, so the part B sweeps have a request to replay for
 * them. Nothing is asserted here: scenario.ts already proves these numbers.
 */
import { addDays, algiersToday, cashAccounts, client, company, invite, openingStock, product, supplier } from '../../lib/audit.ts';

export async function coreChain(): Promise<void> {
  const c = await company('Core');
  const o = c.owner;
  const today = algiersToday();
  // A step that fails must not stop the recording; both worlds fail the same way.
  const post = async <T>(path: string, body: unknown = {}, key?: string | null): Promise<T> =>
    (await o.send<T>('POST', path, body, key === undefined ? undefined : key)).body;
  const send = async <T>(m: 'PUT' | 'PATCH' | 'DELETE', path: string, body: unknown = {}): Promise<T> =>
    (await o.send<T>(m, path, body, null)).body;

  const seller = await invite(c, 'SELLER');
  const accounts = await cashAccounts(c);
  const caisse = accounts.find((a) => a.type === 'CAISSE' && a.isDefault)!;
  const sup = await supplier(c);
  const cat = await post<{ id: string }>('/categories', { name: 'Boissons', parentId: null }, null);
  await post('/categories', { name: 'Jus', parentId: cat.id }, null);
  await send('PATCH', `/categories/${cat.id}`, { name: 'Boissons gazeuses' });
  const brand = await post<{ id: string }>('/brands', { name: 'Marque A', supplierId: sup }, null);
  await send('PATCH', `/brands/${brand.id}`, { supplierId: sup });
  await post('/units', { name: 'Palette', allowsDecimal: false }, null);
  await send('PATCH', `/price-levels/${c.levels[0]}`, { name: 'Gros' });
  const sector = await post<{ id: string }>('/sectors', { name: 'Centre', wilaya: 'Alger', communes: ['Kouba'] }, null);
  await send('PATCH', `/sectors/${sector.id}`, { name: 'Centre ville' });

  const p = await product(c, { priceHt: '1000', brandId: brand.id });
  const full = (await o.get<Record<string, unknown> & { units: { id: string; unitId: string; factorToBase: string; barcode: string | null; isDefaultSale: boolean; isDefaultPurchase: boolean }[]; prices: { unitId: string; priceLevelId: string; priceHt: string }[] }>(`/products/${p.id}`)).body;
  await send('PATCH', `/products/${p.id}`, {
    reference: full['reference'],
    designation: 'Article renommé',
    baseUnitId: p.unitId,
    tvaRate: '19',
    minStock: '0',
    categoryId: cat.id,
    brandId: brand.id,
    units: (full.units ?? []).map((u) => ({ unitId: u.unitId, factorToBase: u.factorToBase, barcode: u.barcode, isDefaultSale: u.isDefaultSale, isDefaultPurchase: u.isDefaultPurchase })),
    prices: c.levels.slice(0, 3).map((priceLevelId) => ({ unitId: p.unitId, priceLevelId, priceHt: '1100' })),
  });
  await post(`/products/${p.id}/archive`, {}, null);
  await post(`/products/${p.id}/restore`, {}, null);
  await openingStock(c, p, '200', '500');
  await o.get(`/stock/${p.id}`);
  await o.get(`/stock/${p.id}/movements`);
  await post('/stock/adjustments', { reason: 'ERREUR', lines: [{ productId: p.id, unitId: p.unitId, qty: '-1' }] });

  const cl = await client(c, 'Client core', { sectorId: sector.id, sellerId: seller.id });
  const cl2 = await client(c, 'Client deux');
  const clFull = (await o.get<{ code: string; name: string }>(`/clients/${cl}`)).body;
  await send('PATCH', `/clients/${cl}`, { code: clFull.code, name: clFull.name, type: 'PARTICULIER', phone: '0550123456', sectorId: sector.id, assignedSellerId: seller.id });
  await send('PATCH', '/clients/bulk-assign', { clientIds: [cl, cl2], assignedSellerId: seller.id, sectorId: sector.id });
  await post(`/clients/${cl}/opening-balance`, { amount: '1500', date: addDays(today, -30) });
  await post(`/clients/${cl}/adjustments`, { amount: '-100', reason: 'geste commercial' });
  await o.get(`/clients/${cl}/statement?from=${addDays(today, -40)}&to=${today}`);
  await o.get(`/clients/${cl}/unpaid-documents`);
  await o.get(`/sales/price-preview?clientId=${cl}&productUnitId=${full.units?.[0]?.id}`);
  await post('/pricing/preview', { clientId: cl, lines: [{ productId: p.id, unitId: p.unitId, qty: '2' }] }, null);

  const line = { productId: p.id, unitId: p.unitId, qty: '3', unitPriceHt: '1000' };
  const draft = await post<{ id: string; version?: number }>('/sales', { type: 'BL', clientId: cl, documentDate: today, lines: [line] });
  await send('PUT', `/sales/${draft.id}`, { type: 'BL', clientId: cl, documentDate: today, version: draft.version, lines: [{ ...line, qty: '4' }] });
  await post(`/sales/${draft.id}/validate`, { paidAmount: '1000', paymentMode: 'ESPECES', forceCredit: false, cashAccountId: caisse.id });
  const sale = (await o.get<{ id: string; lines: { id: string }[] }>(`/sales/${draft.id}`)).body;
  await send('PATCH', `/sales/${draft.id}/seller`, { sellerId: seller.id, reason: 'vente du vendeur' });
  await post(`/sales/${draft.id}/returns`, { disposition: 'RESTOCK', reason: 'retour', lines: [{ saleLineId: sale.lines?.[0]?.id, qty: '1' }] });
  const quick = await post<{ sale: { id: string } }>('/sales/quick', { type: 'BL', clientId: cl, documentDate: today, paidAmount: '0', paymentMode: 'ESPECES', lines: [line] });
  const quick2 = await post<{ sale: { id: string } }>('/sales/quick', { type: 'BL', clientId: cl, documentDate: today, paidAmount: '0', paymentMode: 'ESPECES', lines: [line] });
  const fac = await post<{ sale?: { id: string }; id?: string }>('/invoices/from-bls', { saleIds: [quick.sale?.id, quick2.sale?.id], documentDate: today });
  const facId = fac.sale?.id ?? fac.id;
  const toCancel = await post<{ sale: { id: string } }>('/sales/quick', { type: 'BL', clientId: cl2, documentDate: today, paidAmount: '0', paymentMode: 'ESPECES', lines: [line] });
  await post(`/sales/${toCancel.sale?.id}/cancel`, { reason: 'erreur de saisie' });

  const pay = await post<{ id: string }>('/payments', { clientId: cl, amount: '500', mode: 'ESPECES', cashAccountId: caisse.id });
  await o.get(`/payments/${pay.id}`);
  await send('PATCH', `/payments/${pay.id}/collector`, { collectedBy: seller.id, reason: 'encaissé par le vendeur' });
  const pay2 = await post<{ id: string }>('/payments', { clientId: cl, amount: '200', mode: 'ESPECES' });
  await post(`/payments/${pay2.id}/cancel`, { reason: 'erreur' });

  // Printing and sharing.
  await o.get(`/documents/BL/${draft.id}/pdf`);
  await o.get(`/documents/FAC/${facId}/pdf`);
  await o.get(`/payments/${pay.id}/receipt.pdf`);
  await o.get(`/clients/${cl}/statement/pdf?from=${addDays(today, -40)}&to=${today}`);
  await o.get(`/suppliers/${sup}/statement/pdf?from=${addDays(today, -40)}&to=${today}`);
  const link = await post<{ id: string }>('/share-links', { docType: 'FACTURE', docId: facId }, null);
  await post('/share-links', { docType: 'RELEVE', docId: cl, from: addDays(today, -40), to: today }, null);
  await send('DELETE', `/share-links/${link.id}`);

  // Purchases.
  const br = await post<{ id: string; version?: number }>('/purchases', { supplierId: sup, documentDate: today, lines: [{ productId: p.id, unitId: p.unitId, qty: '10', unitCost: '450' }] });
  await send('PUT', `/purchases/${br.id}`, { supplierId: sup, documentDate: today, version: br.version, lines: [{ productId: p.id, unitId: p.unitId, qty: '12', unitCost: '450' }] });
  await post(`/purchases/${br.id}/validate`, {});
  const brFull = (await o.get<{ lines: { id: string }[] }>(`/purchases/${br.id}`)).body;
  await post(`/purchases/${br.id}/returns`, { reason: 'abîmé', lines: [{ purchaseLineId: brFull.lines?.[0]?.id, qty: '1' }] });
  await o.get(`/suppliers/${sup}`);
  await o.get(`/suppliers/${sup}/ledger`);
  await o.get(`/suppliers/${sup}/statement?from=${addDays(today, -40)}&to=${today}`);
  await send('PATCH', `/suppliers/${sup}`, { phone: '021000000' });

  // Inventory.
  const inv = await post<{ id: string }>('/inventories', { note: 'inventaire audit' });
  await o.get(`/inventories/${inv.id}`);
  await send('PUT', `/inventories/${inv.id}/lines`, { lines: [{ productId: p.id, unitId: p.unitId, qty: '190' }] });
  await post(`/inventories/${inv.id}/validate`, {});
  const inv2 = await post<{ id: string }>('/inventories', { note: 'à annuler' });
  await post(`/inventories/${inv2.id}/cancel`, {});

  // Dépôts, promotions, users.
  const wh = await post<{ id: string }>('/warehouses', { name: 'Dépôt Est', type: 'SECONDARY', assignedUserId: null }, null);
  await o.get(`/warehouses/${wh.id}`);
  await send('PATCH', `/warehouses/${wh.id}`, { name: 'Dépôt Est 2' });
  await send('PUT', `/warehouses/${wh.id}/brands`, { brandIds: [brand.id] });
  await send('PUT', `/warehouses/${wh.id}/categories`, { categoryIds: [cat.id] });
  await o.get(`/users/${seller.id}`);
  await o.get(`/users/${seller.id}/access`);
  await send('PUT', `/users/${seller.id}/access`, { access: [{ warehouseId: wh.id, level: 'OPERATE' }, { warehouseId: c.mainWarehouseId, level: 'OPERATE' }] });
  await send('PUT', `/users/${seller.id}/permissions`, { grants: ['SALE_CANCEL'], revokes: [] });
  await send('PUT', `/users/${seller.id}`, { fullName: 'Vendeur renommé', email: seller.email, role: 'SELLER', managerId: null });
  await post(`/users/${seller.id}/reset-password`, { mode: 'LINK' }, null);
  await post(`/users/${seller.id}/deactivate`, {}, null);
  await post(`/users/${seller.id}/reactivate`, {}, null);
  await send('PATCH', `/clients/${cl}/location`, { lat: 36.75, lng: 3.05, accuracyM: 10 });
  await post('/visits', { clientId: cl, startedAt: new Date().toISOString(), outcome: 'NO_SALE', reason: 'CLOSED', note: 'passage', saleId: null, paymentId: null });

  // Lists and reports with a foreign key in the query string.
  for (const path of [
    `/sales?clientId=${cl}`,
    `/sales?sellerId=${seller.id}`,
    `/payments?clientId=${cl}`,
    `/purchases?supplierId=${sup}`,
    `/supplier-payments?supplierId=${sup}`,
    `/stock?warehouseId=${wh.id}`,
    `/products?categoryId=${cat.id}&brandId=${brand.id}`,
    `/clients?sectorId=${sector.id}&sellerId=${seller.id}`,
    `/audit-logs?userId=${seller.id}`,
    `/reports/sales?from=${addDays(today, -30)}&to=${today}&sellerId=${seller.id}&brandId=${brand.id}&warehouseId=${c.mainWarehouseId}`,
    `/reports/margin?from=${addDays(today, -30)}&to=${today}&teamOf=${seller.id}`,
    `/cash-accounts/${caisse.id}`,
    `/cash-accounts/${caisse.id}/movements`,
    `/expenses?cashAccountId=${caisse.id}`,
  ])
    await o.get(path);

  // Deletes last.
  await send('DELETE', `/clients/${cl2}`);
  await send('DELETE', `/sectors/${sector.id}`);
  await send('DELETE', `/warehouses/${wh.id}`);
}
