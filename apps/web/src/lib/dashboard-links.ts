import type { PaymentMode } from '@erp/shared';

/**
 * Where each dashboard figure leads (phase 33: every number is a door). Pure, so the
 * hrefs are unit-tested; the dashboard's active filters (period, seller, team, brand) are
 * carried to the list, which reads them from its URL.
 */
export interface DrillFilters {
  sellerId?: string;
  teamOf?: string;
  brandId?: string;
}

function href(path: string, params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

export const drill = {
  /** The sales of a range, narrowed like the figure. */
  sales: (from: string, to: string, f: DrillFilters = {}) =>
    href('/ventes', { from, to, sellerId: f.sellerId, teamOf: f.teamOf, brandId: f.brandId }),
  overview: (from: string, to: string) => href('/vue-ensemble', { from, to }),
  /** Versements received that day, of one mode or all. */
  versements: (day: string, mode?: PaymentMode) =>
    href('/versements', { from: day, to: day, mode }),
  treasury: () => '/tresorerie',
  credit: () => href('/clients', { sort: 'balance_desc', hasBalance: '1' }),
  overLimit: () => href('/clients', { overLimit: '1' }),
  stock: (level: 'out' | 'low') => href('/stock', { level }),
  client: (id: string) => `/clients/${id}`,
  supplier: (id: string) => `/achats/fournisseurs/${id}`,
};
