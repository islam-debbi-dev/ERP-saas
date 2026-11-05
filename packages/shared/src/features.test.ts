import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_EDITION,
  Activity,
  Edition,
  EDITIONS,
  editionsWith,
  effectiveFeatures,
  Feature,
  FEATURES,
  hasFeature,
} from './features';

describe('effectiveFeatures', () => {
  it('turns the paie off without the DRH, even when granted', () => {
    expect(effectiveFeatures(Edition.ESSENTIEL, [Feature.PAYROLL])).not.toContain(Feature.PAYROLL);
    expect(effectiveFeatures(Edition.DISTRIBUTION, [], [Feature.HR])).not.toContain(
      Feature.PAYROLL,
    );
    expect(effectiveFeatures(Edition.ESSENTIEL, [Feature.HR, Feature.PAYROLL])).toContain(
      Feature.PAYROLL,
    );
  });

  it('uses the edition defaults', () => {
    expect(effectiveFeatures(Edition.ESSENTIEL)).toEqual([
      Feature.EXPENSES,
      Feature.AI_ASSISTANT,
    ]);
    expect(effectiveFeatures(Edition.IMPORT)).toEqual([
      Feature.WAREHOUSES,
      Feature.IMPORT_COSTS,
      Feature.EXPENSES,
      Feature.AI_ASSISTANT,
    ]);
    expect(effectiveFeatures(Edition.DISTRIBUTION)).not.toContain(Feature.IMPORT_COSTS);
    expect(effectiveFeatures(Edition.DISTRIBUTION)).toContain(Feature.MOBILE_APP);
    expect(effectiveFeatures(Edition.DISTRIBUTION)).toContain(Feature.MULTI_UNIT);
    expect(effectiveFeatures(Edition.IMPORT)).not.toContain(Feature.MULTI_UNIT);
    expect(effectiveFeatures(Edition.ENTREPRISE)).toEqual(FEATURES);
    // The DRH (phase 31): the two big editions, grantable to the others.
    expect(editionsWith(Feature.HR)).toEqual([Edition.DISTRIBUTION, Edition.ENTREPRISE]);
    expect(editionsWith(Feature.PAYROLL)).toEqual([Edition.DISTRIBUTION, Edition.ENTREPRISE]);
  });

  it('adds grants and removes revokes', () => {
    expect(effectiveFeatures(Edition.ESSENTIEL, [Feature.GEO_CHECK])).toEqual([
      Feature.GEO_CHECK,
      Feature.EXPENSES,
      Feature.AI_ASSISTANT,
    ]);
    expect(effectiveFeatures(Edition.IMPORT, [], [Feature.WAREHOUSES])).toEqual([
      Feature.IMPORT_COSTS,
      Feature.EXPENSES,
      Feature.AI_ASSISTANT,
    ]);
    // A revoke wins over a grant of the same feature.
    expect(effectiveFeatures(Edition.ESSENTIEL, [Feature.GEO_CHECK], [Feature.GEO_CHECK])).toEqual([
      Feature.EXPENSES,
      Feature.AI_ASSISTANT,
    ]);
    // Every edition has the dépenses (phase 25); the super-admin can still take them away.
    for (const e of Object.values(Edition)) {
      expect(effectiveFeatures(e)).toContain(Feature.EXPENSES);
    }
    expect(effectiveFeatures(Edition.ESSENTIEL, [], [Feature.EXPENSES])).toEqual([
      Feature.AI_ASSISTANT,
    ]);
    // The assistant too (phase 30): in every edition, switchable off per company.
    for (const e of Object.values(Edition)) {
      expect(effectiveFeatures(e)).toContain(Feature.AI_ASSISTANT);
      expect(effectiveFeatures(e, [], [Feature.AI_ASSISTANT])).not.toContain(Feature.AI_ASSISTANT);
    }
  });

  it('ignores unknown strings', () => {
    expect(effectiveFeatures(Edition.ESSENTIEL, ['TELEPORT', ''], ['NOPE'])).toEqual([
      Feature.EXPENSES,
      Feature.AI_ASSISTANT,
    ]);
  });

  it('keeps the FEATURES order whatever the grant order', () => {
    expect(
      effectiveFeatures(Edition.ESSENTIEL, [Feature.IMPORT_COSTS, Feature.SALES_FORCE]),
    ).toEqual([
      Feature.SALES_FORCE,
      Feature.IMPORT_COSTS,
      Feature.EXPENSES,
      Feature.AI_ASSISTANT,
    ]);
  });
});

describe('hasFeature / editionsWith', () => {
  it('checks the effective list', () => {
    expect(hasFeature({ features: [Feature.GEO_CHECK] }, Feature.GEO_CHECK)).toBe(true);
    expect(hasFeature({ features: [] }, Feature.GEO_CHECK)).toBe(false);
  });

  it('lists the editions that include a feature, smallest first', () => {
    expect(editionsWith(Feature.IMPORT_COSTS)).toEqual([Edition.IMPORT, Edition.ENTREPRISE]);
    expect(editionsWith(Feature.WAREHOUSES)).toEqual([
      Edition.IMPORT,
      Edition.DISTRIBUTION,
      Edition.ENTREPRISE,
    ]);
    for (const f of FEATURES) expect(editionsWith(f)).toContain(Edition.ENTREPRISE);
  });

  it('maps every activity to an edition', () => {
    expect(ACTIVITY_EDITION[Activity.GROSSISTE]).toBe(Edition.ESSENTIEL);
    expect(ACTIVITY_EDITION[Activity.IMPORTATEUR]).toBe(Edition.IMPORT);
    expect(ACTIVITY_EDITION[Activity.DISTRIBUTEUR]).toBe(Edition.DISTRIBUTION);
    expect(EDITIONS).toHaveLength(4);
  });
});
