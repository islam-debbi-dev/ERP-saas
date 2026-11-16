import { type DayRange, type StatDimension, type StatFilters, type StatMeasure } from '@erp/shared';

/**
 * The list behind a figure (phase 37 drill-down): a path of the web app with the filters
 * of the existing lists. A figure without a list of its own opens the statistics view
 * that details it.
 */
const qs = (params: Record<string, string | undefined>): string => {
  const entries = Object.entries(params).filter((e): e is [string, string] => !!e[1]);
  return new URLSearchParams(entries).toString();
};
const path = (base: string, params: Record<string, string | undefined>): string => {
  const query = qs(params);
  return query ? `${base}?${query}` : base;
};

/** A single-valued filter becomes a list filter; several values cannot. */
const one = (values: string[] | undefined): string | undefined =>
  values?.length === 1 ? values[0] : undefined;

const SALES: readonly StatMeasure[] = [
  'caTtc',
  'nbBl',
  'dropSize',
  'skuLines',
  'skuPerBl',
  'weightT',
  'weightUnknownLines',
  'activeClients',
  'activeVehicles',
  'damagedQty',
  'damagedTtc',
];
const PAYMENTS: readonly StatMeasure[] = ['versements', 'recouvrement'];
const ORDERS: readonly StatMeasure[] = [
  'bcCount',
  'bcTtc',
  'orderedQty',
  'deliveredQty',
  'deliveryRate',
  'openOrders',
];
const VISITS: readonly StatMeasure[] = [
  'visitsPlanned',
  'plannedVisited',
  'plannedSuccess',
  'visitsDone',
  'visitsSuccess',
  'visitsNoSale',
  'visitRate',
  'successPlannedRate',
  'successRate',
];

type SalesOn = {
  /** A truck (or one dépôt alone). */
  warehouseId?: string;
  /** A dépôt with its trucks, as the figures count it. */
  depotId?: string;
  clientId?: string;
  brandId?: string;
  segmentId?: string;
};

/** The sales list as the statistics count it: validated in the period, with its total. */
export function salesLink(range: DayRange, on: SalesOn = {}): string {
  return path('/ventes', {
    status: 'VALIDATED',
    validatedFrom: range.from,
    validatedTo: range.to,
    ...on,
  });
}

/** The list behind a figure, for one truck (`vehicleId`) or for everything in the filters. */
export function measureLink(
  measure: StatMeasure,
  range: DayRange,
  filters: StatFilters,
  vehicleId?: string,
): string | null {
  const truck = vehicleId ?? one(filters.vehicleIds);
  const depot = truck ? undefined : one(filters.warehouseIds);
  if (SALES.includes(measure)) {
    return salesLink(range, {
      warehouseId: truck,
      depotId: depot,
      clientId: one(filters.clientIds),
      brandId: one(filters.brandIds),
      segmentId: one(filters.segmentIds),
    });
  }
  if (PAYMENTS.includes(measure)) {
    return path('/versements', {
      status: 'VALID',
      from: range.from,
      to: range.to,
      vehicleId: truck,
      warehouseId: depot,
      clientId: one(filters.clientIds),
    });
  }
  if (ORDERS.includes(measure)) {
    const taken = measure === 'bcCount' || measure === 'bcTtc';
    return path('/commandes', {
      confirmedFrom: range.from,
      confirmedTo: range.to,
      vehicleId: taken ? truck : undefined,
      deliveryVehicleId: taken ? undefined : truck,
      clientId: one(filters.clientIds),
    });
  }
  if (VISITS.includes(measure)) {
    return path('/tournees/rapports', {
      by: 'vehicle',
      from: range.from,
      to: range.to,
      vehicleId: truck,
    });
  }
  if (measure === 'cashEcart') return path('/tournees/cloture', {});
  // Chargements.
  return path('/stock/transferts', {
    type: 'LOAD',
    toWarehouseId: truck,
    from: range.from,
    to: range.to,
  });
}

/** The list behind one row of a "by dimension" table. */
export function dimensionLink(
  dimension: StatDimension,
  key: string | null,
  range: DayRange,
): string | null {
  if (key === null) return null;
  const stats = (params: Record<string, string>) =>
    path('/statistiques', { from: range.from, to: range.to, ...params });
  switch (dimension) {
    case 'vehicle':
      return salesLink(range, { warehouseId: key });
    case 'depot':
      return salesLink(range, { depotId: key });
    case 'client':
      return salesLink(range, { clientId: key });
    case 'brand':
      return salesLink(range, { brandId: key });
    case 'segment':
      return salesLink(range, { segmentId: key });
    case 'sector':
      return path('/clients', { sectorId: key });
    case 'vehicleType':
      return stats({ view: 'vehicles', vehicleTypeIds: key });
    case 'activity':
      return stats({ view: 'vehicles', activities: key });
    case 'vehicleWilaya':
      return stats({ view: 'vehicles', vehicleWilayas: key });
    case 'clientWilaya':
      return stats({ view: 'clients', clientWilayas: key });
    case 'category':
    case 'subCategory':
      return stats({ view: 'products', categoryIds: key });
    case 'product':
      return stats({ view: 'products', productIds: key });
  }
}
