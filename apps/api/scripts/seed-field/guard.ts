/** The tenant guard and the preflight checks. Pure, so they are unit tested. */
export interface Me {
  email: string | null;
  role: string;
  tenantName: string;
  features: string[];
}

export const REQUIRED_FEATURES = [
  'MOBILE_APP',
  'TOURNEES',
  'GEO_CHECK',
  'INCENTIVES',
  'WAREHOUSES',
  'SALES_FORCE',
  'PROMOTIONS',
] as const;

export const DEMO_NAME = /demo.*volume/i;

/** Throws unless the logged-in account is the owner of the demo-volume company. */
export function assertDemoVolumeTenant(me: Me, expectedEmail: string): void {
  const problems: string[] = [];
  if ((me.email ?? '').toLowerCase() !== expectedEmail.toLowerCase()) {
    problems.push(`the owner email is not ${expectedEmail}`);
  }
  if (me.role !== 'OWNER') problems.push(`the role is ${me.role}, not OWNER`);
  if (!DEMO_NAME.test(me.tenantName)) {
    problems.push(`the company is "${me.tenantName}", not the demo-volume one`);
  }
  if (problems.length > 0) {
    throw new Error(`Refusing to write: ${problems.join('; ')}.`);
  }
}

export interface PreflightInput {
  me: Me;
  maxMobileSellers: number | null;
  maxUsers: number | null;
  /** Users that exist now, and how many of them the seed still has to create. */
  userCount: number;
  usersToCreate: number;
  geoCheckMode: string;
  creditLimitMode: string;
}

/** The list of things to fix in the super-admin before the seed can run. */
export function preflightProblems(i: PreflightInput): string[] {
  const out: string[] = [];
  for (const f of REQUIRED_FEATURES) {
    if (!i.me.features.includes(f)) out.push(`feature ${f} is off`);
  }
  if (i.maxMobileSellers !== null && i.maxMobileSellers < 4) {
    out.push(`maxMobileSellers is ${i.maxMobileSellers}, it must be at least 4`);
  }
  if (i.maxUsers !== null && i.userCount + i.usersToCreate > i.maxUsers) {
    out.push(
      `maxUsers is ${i.maxUsers}: ${i.userCount} users exist and ${i.usersToCreate} more are needed`,
    );
  }
  if (i.geoCheckMode !== 'FLAG') {
    out.push(`geoCheckMode is ${i.geoCheckMode}, it must be FLAG (far sales are flagged, not refused)`);
  }
  if (i.creditLimitMode === 'BLOCK') {
    out.push('creditLimitMode is BLOCK, it must be WARN (8 clients are over their plafond on purpose)');
  }
  return out;
}
