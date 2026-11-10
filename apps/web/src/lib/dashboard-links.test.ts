import { describe, expect, it } from 'vitest';
import { saleListQuerySchema } from '@erp/shared';
import { drill } from './dashboard-links';
import { parseUrlFilters, patchSearch } from './url-filters';

const SELLER = '6f1c2f50-6a4b-4d1e-9b59-2a3c1d5e7f80';
const BRAND = '0b7a6c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d';

describe('dashboard drill-down hrefs', () => {
  it('the sales cards carry the period and the figure filters, nothing empty', () => {
    expect(drill.sales('2026-11-10', '2026-11-10')).toBe('/ventes?from=2026-11-10&to=2026-11-10');
    expect(
      drill.sales('2026-11-01', '2026-11-10', { sellerId: SELLER, teamOf: '', brandId: BRAND }),
    ).toBe(`/ventes?from=2026-11-01&to=2026-11-10&sellerId=${SELLER}&brandId=${BRAND}`);
  });

  it('each other card goes to its list, already filtered', () => {
    expect(drill.versements('2026-11-10', 'CHEQUE')).toBe(
      '/versements?from=2026-11-10&to=2026-11-10&mode=CHEQUE',
    );
    expect(drill.versements('2026-11-10')).toBe('/versements?from=2026-11-10&to=2026-11-10');
    expect(drill.overview('2026-11-01', '2026-11-10')).toBe(
      '/vue-ensemble?from=2026-11-01&to=2026-11-10',
    );
    expect(drill.credit()).toBe('/clients?sort=balance_desc&hasBalance=1');
    expect(drill.overLimit()).toBe('/clients?overLimit=1');
    expect(drill.stock('out')).toBe('/stock?level=out');
    expect(drill.stock('low')).toBe('/stock?level=low');
    expect(drill.client('c1')).toBe('/clients/c1');
  });
});

describe('list filters in the URL', () => {
  const q = saleListQuerySchema.shape;
  const spec = { type: q.type, from: q.from, sellerId: q.sellerId };

  it('keeps valid values and drops unknown or broken ones without an error', () => {
    const params = new URLSearchParams(`type=FACTURE&from=2026-11-01&sellerId=${SELLER}&other=x`);
    expect(parseUrlFilters(spec, params)).toEqual({
      type: 'FACTURE',
      from: '2026-11-01',
      sellerId: SELLER,
    });
    const bad = new URLSearchParams('type=AVOIR&from=10/11/2026&sellerId=not-a-uuid');
    expect(parseUrlFilters(spec, bad)).toEqual({ type: '', from: '', sellerId: '' });
  });

  it('a patch sets or removes keys and keeps the others', () => {
    const params = new URLSearchParams('type=BL&from=2026-11-01&tab=x');
    expect(patchSearch(params, { type: '', to: '2026-11-10' })).toBe(
      'from=2026-11-01&tab=x&to=2026-11-10',
    );
  });
});
