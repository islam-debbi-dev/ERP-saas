import {
  type StatCell,
  type StatDimension,
  type StatMeasure,
  type StatsByDimensionDto,
  type StatsByVehicleDto,
  type StatsDispersionDto,
  type StatsOverviewDto,
  type StatsTimelineDto,
  type StatsVehicleDayDto,
  type StatsVisitsDto,
  StatUnit,
  type StatVehicleRef,
  wilayaLabel,
} from '@erp/shared';
import { buildTableXlsx, type XlsxKind, type XlsxTable } from '../reports/report-xlsx';

/** French column titles, like the printed documents and the other exports. */
export const MEASURE_TITLES: Record<StatMeasure, string> = {
  caTtc: 'CA TTC',
  nbBl: 'Nb BL',
  dropSize: 'Drop size',
  skuLines: 'Lignes SKU',
  skuPerBl: 'SKU / BL',
  weightT: 'Poids vendu (t)',
  weightUnknownLines: 'Lignes sans poids',
  activeClients: 'Clients actifs',
  versements: 'Versements',
  recouvrement: 'Taux de recouvrement %',
  bcCount: 'Bons de commande',
  bcTtc: 'Bons de commande TTC',
  orderedQty: 'Quantité commandée',
  deliveredQty: 'Quantité livrée',
  deliveryRate: 'Taux de livraison %',
  openOrders: 'Commandes en attente',
  loadCount: 'Chargements',
  loadValueCost: 'Valeur de chargement (CUMP)',
  loadValueTtc: 'Valeur de chargement (TTC prix 1)',
  loadWeightT: 'Poids chargé (t)',
  loadWeightCapT: 'Poids chargé avec capacité (t)',
  loadCapacityT: 'Capacité (t)',
  fillRate: 'Taux de remplissage %',
  damagedQty: 'Avaries (quantité)',
  damagedTtc: 'Avaries TTC',
  cashEcart: 'Écart de caisse',
  visitsPlanned: 'Visites planifiées',
  plannedVisited: 'Planifiées visitées',
  plannedSuccess: 'Planifiées avec succès',
  visitsDone: 'Visites effectuées',
  visitsSuccess: 'Visites avec succès',
  visitsNoSale: 'Visites sans achat',
  visitRate: 'Visités / planifiés %',
  successPlannedRate: 'Succès / planifiés %',
  successRate: 'Succès / visités %',
  activeVehicles: 'Véhicules actifs',
};

const DIMENSION_TITLES: Record<StatDimension, string> = {
  vehicle: 'Véhicule',
  vehicleType: 'Type de véhicule',
  activity: 'Activité',
  depot: 'Dépôt',
  vehicleWilaya: 'Wilaya du véhicule',
  clientWilaya: 'Wilaya du client',
  segment: 'Type de client',
  sector: 'Secteur',
  brand: 'Marque',
  category: 'Famille',
  subCategory: 'Sous-famille',
  product: 'Produit',
  client: 'Client',
};

const ACTIVITY_TITLES: Record<string, string> = {
  CASH_VAN: 'Vente directe',
  PRESALE: 'Prévente',
  DELIVERY: 'Livraison',
  MIXED: 'Mixte',
};

const KINDS: Record<StatUnit, XlsxKind> = {
  [StatUnit.DA]: 'money',
  [StatUnit.COUNT]: 'count',
  [StatUnit.TONNE]: 'tonne',
  [StatUnit.PERCENT]: 'rate',
  [StatUnit.RATIO]: 'ratio',
  [StatUnit.QTY]: 'qty',
};

// Excel cells are floats; the exact value is in the API, this is a spreadsheet copy.
const n = (value: string | null): number | null => (value === null ? null : Number(value));
const measureColumns = (cells: StatCell[]) =>
  cells.map((c) => ({
    title: c.estimated ? `${MEASURE_TITLES[c.measure]} (estimé)` : MEASURE_TITLES[c.measure],
    kind: KINDS[c.unit],
  }));
const values = (cells: StatCell[]) => cells.map((c) => n(c.value));
const span = (r: { from: string; to: string }) => `du ${r.from} au ${r.to}`;
const vehicleName = (v: StatVehicleRef | null) =>
  v === null ? 'Sans véhicule / dépôt' : v.code ? `${v.code} · ${v.name}` : v.name;
const wilaya = (code: number | null) => wilayaLabel(code, 'fr');

export function overviewTable(dto: StatsOverviewDto): XlsxTable {
  return {
    sheet: 'Vue globale',
    title: `Statistiques distribution ${span(dto)}`,
    columns: [{ title: 'Période', kind: 'text' }, ...measureColumns(dto.tiles)],
    rows: [
      [span(dto), ...values(dto.tiles)],
      ...(dto.compare ? [[span(dto.compare), ...dto.tiles.map((t) => n(t.previous))]] : []),
    ],
  };
}

export function byVehicleTable(dto: StatsByVehicleDto): XlsxTable {
  return {
    sheet: 'Véhicules',
    title: `Statistiques par véhicule ${span(dto)}`,
    columns: [
      { title: 'Véhicule', kind: 'text' },
      { title: 'Type', kind: 'text' },
      { title: 'Wilaya', kind: 'text' },
      { title: 'Dépôt', kind: 'text' },
      { title: 'Chauffeur(s)', kind: 'text' },
      ...measureColumns(dto.totals),
    ],
    rows: dto.rows.map((r) => [
      vehicleName(r.vehicle),
      r.vehicle?.type ? `${r.vehicle.type.code} · ${r.vehicle.type.name}` : null,
      wilaya(r.vehicle?.wilayaCode ?? null),
      r.vehicle?.depot?.name ?? null,
      r.drivers.map((d) => d.fullName).join(', ') || null,
      ...values(r.cells),
    ]),
    totals: ['Total', null, null, null, null, ...values(dto.totals)],
  };
}

function dimensionLabel(dimension: StatDimension, key: string | null, label: string | null) {
  if (key === null) return dimension === 'vehicle' ? 'Sans véhicule / dépôt' : 'Non renseigné';
  if (dimension === 'activity') return ACTIVITY_TITLES[key] ?? key;
  if (dimension === 'vehicleWilaya') return wilaya(Number(key)) ?? key;
  return label ?? key;
}

export function byDimensionTable(dto: StatsByDimensionDto): XlsxTable {
  return {
    sheet: DIMENSION_TITLES[dto.dimension],
    title: `Statistiques par ${DIMENSION_TITLES[dto.dimension].toLowerCase()} ${span(dto)}`,
    columns: [
      { title: DIMENSION_TITLES[dto.dimension], kind: 'text' },
      ...measureColumns(dto.totals),
    ],
    rows: [
      ...dto.rows.map((r) => [dimensionLabel(dto.dimension, r.key, r.label), ...values(r.cells)]),
      ...(dto.others ? [[`Autres (${dto.others.count})`, ...values(dto.others.cells)]] : []),
    ],
    totals: ['Total', ...values(dto.totals)],
  };
}

export function timelineTable(dto: StatsTimelineDto): XlsxTable {
  const kind = KINDS[dto.unit];
  return {
    sheet: 'Évolution',
    title: `${MEASURE_TITLES[dto.measure]} ${span(dto)}`,
    columns: [
      { title: 'Période', kind: 'text' },
      { title: MEASURE_TITLES[dto.measure], kind },
      ...(dto.compare ? [{ title: 'Période comparée', kind }] : []),
      ...dto.series.map((s) => ({
        title: dimensionLabel(dto.splitBy ?? 'vehicle', s.key, s.label),
        kind,
      })),
    ],
    rows: dto.buckets.map((b, i) => [
      b.from === b.to ? b.from : `${b.from} – ${b.to}`,
      n(b.value),
      ...(dto.compare ? [n(b.previous)] : []),
      ...dto.series.map((s) => n(s.values[i] ?? null)),
    ]),
  };
}

export function visitsTable(dto: StatsVisitsDto): XlsxTable {
  return {
    sheet: 'Visites',
    title: `Visites par véhicule ${span(dto)}`,
    columns: [{ title: 'Véhicule', kind: 'text' }, ...measureColumns(dto.totals)],
    rows: dto.rows.map((r) => [vehicleName(r.vehicle), ...values(r.cells)]),
    totals: ['Total', ...values(dto.totals)],
  };
}

export function dispersionTable(dto: StatsDispersionDto): XlsxTable {
  return {
    sheet: 'Dispersion',
    title: `CA TTC par véhicule et par jour ${span(dto)}`,
    columns: [
      { title: 'Véhicule', kind: 'text' },
      ...dto.days.map((d) => ({ title: d, kind: 'money' as const })),
      { title: 'Total', kind: 'money' },
      { title: 'Nb BL', kind: 'count' },
    ],
    rows: dto.rows.map((r) => [
      vehicleName(r.vehicle),
      ...r.cells.map((c) => Number(c.caTtc)),
      Number(r.caTtc),
      r.nbBl,
    ]),
  };
}

export function vehicleDayTable(dto: StatsVehicleDayDto): XlsxTable {
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString('fr-FR', { timeZone: 'Africa/Algiers', hour12: false });
  const section = (
    name: string,
    docs: {
      number: string | null;
      at: string;
      party: string | null;
      amount: string | null;
      weightKg: string | null;
    }[],
  ) => docs.map((d) => [name, d.number, time(d.at), d.party, n(d.amount), n(d.weightKg)]);
  return {
    sheet: 'Journée véhicule',
    title: `Récap journée ${vehicleName(dto.vehicle)} du ${dto.date}`,
    columns: [
      { title: 'Rubrique', kind: 'text' },
      { title: 'Numéro', kind: 'text' },
      { title: 'Heure', kind: 'text' },
      { title: 'Tiers', kind: 'text' },
      { title: 'Montant', kind: 'money' },
      { title: 'Poids (kg)', kind: 'qty' },
    ],
    rows: [
      ...section('Chargement', dto.loads),
      ...section('Vente', dto.sales),
      ...dto.returns.flatMap((r) => section(r.damaged ? 'Avarie' : 'Retour', [r])),
      ...section('Déchargement', dto.unloads),
      ...section('Versement', dto.payments),
      ['Cash attendu', null, null, null, n(dto.cash.expected), null],
      ['Cash remis', null, null, null, n(dto.cash.handed), null],
      ['Écart de caisse', null, null, null, n(dto.cash.ecart), null],
      ...dto.cells.map((c) => [
        MEASURE_TITLES[c.measure],
        null,
        null,
        null,
        c.unit === StatUnit.DA ? n(c.value) : null,
        c.unit === StatUnit.DA ? null : n(c.value),
      ]),
    ],
  };
}

export { buildTableXlsx };
