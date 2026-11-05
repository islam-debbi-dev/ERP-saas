/**
 * Modules a company gets on top of the core (phase 13b). Everything built in phases 1–13
 * is core and has no flag. The API enforces them (`@RequireFeature`); the web only hides
 * what is off.
 *
 * Two axes: the plan (Starter / Pro / Business) sets the price and the limits, the
 * edition sets the modules. One codebase, one database: an edition never forks the code.
 */
export const Feature = {
  /** Sellers, teams, sectors, client assignment (phase 14). */
  SALES_FORCE: 'SALES_FORCE',
  /** Several dépôts and trucks, transfers between them. */
  WAREHOUSES: 'WAREHOUSES',
  /** Tournées and visits. */
  TOURNEES: 'TOURNEES',
  /** GPS position checked on sales, versements and visits. */
  GEO_CHECK: 'GEO_CHECK',
  /** Objectifs & primes. */
  INCENTIVES: 'INCENTIVES',
  /** The Flutter app for sellers on the road. */
  MOBILE_APP: 'MOBILE_APP',
  /** UG and promotions. */
  PROMOTIONS: 'PROMOTIONS',
  /** Emballages consignés. */
  PACKAGING: 'PACKAGING',
  /** Dossiers d'importation, devises, coût de revient (phase 22). */
  IMPORT_COSTS: 'IMPORT_COSTS',
  /** Dépôts as business units: teams, brands per dépôt, access per dépôt (phase 24). */
  MULTI_UNIT: 'MULTI_UNIT',
  /** Dépenses and dépôt rent (phase 25). In every edition: a small grossiste pays rent too. */
  EXPENSES: 'EXPENSES',
  /** DRH: personnel, pointage, congés, avances (phase 31). */
  HR: 'HR',
  /** DRH part 2: paie, bulletins, salary payments (phase 31b). Needs HR. */
  PAYROLL: 'PAYROLL',
  /** The in-app help assistant (phase 30). In every edition: help is useful to everyone. */
  AI_ASSISTANT: 'AI_ASSISTANT',
} as const;
export type Feature = (typeof Feature)[keyof typeof Feature];
export const FEATURES = Object.values(Feature);

export const Edition = {
  /** Grossiste who buys from distributors and sells en gros: core only. */
  ESSENTIEL: 'ESSENTIEL',
  /** Importer who sells en gros. */
  IMPORT: 'IMPORT',
  /** Brand distributor with sellers and trucks. */
  DISTRIBUTION: 'DISTRIBUTION',
  ENTREPRISE: 'ENTREPRISE',
} as const;
export type Edition = (typeof Edition)[keyof typeof Edition];
export const EDITIONS = Object.values(Edition);

export const EDITION_FEATURES: Record<Edition, readonly Feature[]> = {
  [Edition.ESSENTIEL]: [Feature.EXPENSES, Feature.AI_ASSISTANT],
  [Edition.IMPORT]: [
    Feature.IMPORT_COSTS,
    Feature.WAREHOUSES,
    Feature.EXPENSES,
    Feature.AI_ASSISTANT,
  ],
  [Edition.DISTRIBUTION]: [
    Feature.SALES_FORCE,
    Feature.WAREHOUSES,
    Feature.TOURNEES,
    Feature.GEO_CHECK,
    Feature.INCENTIVES,
    Feature.MOBILE_APP,
    Feature.PROMOTIONS,
    Feature.PACKAGING,
    Feature.MULTI_UNIT,
    Feature.EXPENSES,
    Feature.HR,
    Feature.PAYROLL,
    Feature.AI_ASSISTANT,
  ],
  [Edition.ENTREPRISE]: FEATURES,
};

/** What the company answers at signup ("Quelle est votre activité ?"). */
export const Activity = {
  GROSSISTE: 'GROSSISTE',
  IMPORTATEUR: 'IMPORTATEUR',
  DISTRIBUTEUR: 'DISTRIBUTEUR',
} as const;
export type Activity = (typeof Activity)[keyof typeof Activity];
export const ACTIVITIES = Object.values(Activity);

/** The edition a new company tries, from its activity. */
export const ACTIVITY_EDITION: Record<Activity, Edition> = {
  [Activity.GROSSISTE]: Edition.ESSENTIEL,
  [Activity.IMPORTATEUR]: Edition.IMPORT,
  [Activity.DISTRIBUTEUR]: Edition.DISTRIBUTION,
};

/**
 * Edition defaults, plus what the super-admin granted, minus what he took away. A revoke
 * wins over a grant of the same feature; unknown strings (a feature removed from the
 * code) are ignored.
 */
export function effectiveFeatures(
  edition: Edition,
  grants: readonly string[] = [],
  revokes: readonly string[] = [],
): Feature[] {
  const set = new Set<string>(EDITION_FEATURES[edition]);
  for (const g of grants) set.add(g);
  for (const r of revokes) set.delete(r);
  // The paie reads the pointage: without the DRH there is nothing to pay from.
  if (!set.has(Feature.HR)) set.delete(Feature.PAYROLL);
  return FEATURES.filter((f) => set.has(f));
}

export function hasFeature(tenant: { features: readonly string[] }, f: Feature): boolean {
  return tenant.features.includes(f);
}

/** The editions that include `f`, smallest first: "available in edition X". */
export function editionsWith(f: Feature): Edition[] {
  return EDITIONS.filter((e) => EDITION_FEATURES[e].includes(f));
}
