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
  it('uses the edition defaults', () => {
    expect(effectiveFeatures(Edition.ESSENTIEL)).toEqual([]);
    expect(effectiveFeatures(Edition.IMPORT)).toEqual([Feature.WAREHOUSES, Feature.IMPORT_COSTS]);
    expect(effectiveFeatures(Edition.DISTRIBUTION)).not.toContain(Feature.IMPORT_COSTS);
    expect(effectiveFeatures(Edition.DISTRIBUTION)).toContain(Feature.MOBILE_APP);
    expect(effectiveFeatures(Edition.ENTREPRISE)).toEqual(FEATURES);
  });

  it('adds grants and removes revokes', () => {
    expect(effectiveFeatures(Edition.ESSENTIEL, [Feature.GEO_CHECK])).toEqual([Feature.GEO_CHECK]);
    expect(effectiveFeatures(Edition.IMPORT, [], [Feature.WAREHOUSES])).toEqual([
      Feature.IMPORT_COSTS,
    ]);
    // A revoke wins over a grant of the same feature.
    expect(effectiveFeatures(Edition.ESSENTIEL, [Feature.GEO_CHECK], [Feature.GEO_CHECK])).toEqual(
      [],
    );
  });

  it('ignores unknown strings', () => {
    expect(effectiveFeatures(Edition.ESSENTIEL, ['TELEPORT', ''], ['NOPE'])).toEqual([]);
  });

  it('keeps the FEATURES order whatever the grant order', () => {
    expect(
      effectiveFeatures(Edition.ESSENTIEL, [Feature.IMPORT_COSTS, Feature.SALES_FORCE]),
    ).toEqual([Feature.SALES_FORCE, Feature.IMPORT_COSTS]);
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
