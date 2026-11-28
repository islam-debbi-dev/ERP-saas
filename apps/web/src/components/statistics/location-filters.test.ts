import { describe, expect, it } from 'vitest';
import * as communes from '@erp/shared/communes';
import { placeFilterName, toggleWilaya } from './location-filters';

describe('the place filters of the statistics', () => {
  it('names a wilaya number and the name an old link carries', () => {
    expect(placeFilterName('clientWilayas', '28', undefined, 'fr')).toBe("28 · M'Sila");
    expect(placeFilterName('clientWilayas', "M'Sila", communes, 'fr')).toBe("28 · M'Sila");
    expect(placeFilterName('clientWilayas', "M'Sila", communes, 'ar')).toMatch(/^28 · .*المسيلة/);
    // While the data loads the old name is still readable.
    expect(placeFilterName('clientWilayas', "M'Sila", undefined, 'fr')).toBe("M'Sila");
  });

  it('never shows a bare commune code or daïra key', () => {
    const commune = communes.communeByCode(101)!;
    const daira = communes.dairaByKey(commune.dairaKey)!;
    expect(placeFilterName('clientCommunes', '101', communes, 'ar')).toBe(commune.ar);
    expect(placeFilterName('clientDairas', daira.key, communes, 'fr')).toBe(daira.fr);
    expect(placeFilterName('clientCommunes', '101', undefined, 'fr')).toBe('…');
    expect(placeFilterName('clientDairas', daira.key, undefined, 'fr')).toBe('…');
  });

  it('removes a wilaya whatever way the link spelled it', () => {
    expect(toggleWilaya(["M'Sila", '16'], 28, communes)).toEqual(['16']);
    expect(toggleWilaya(['28', "M'Sila"], 28, communes)).toEqual([]);
    expect(toggleWilaya(['16'], 28, communes)).toEqual(['16', '28']);
  });
});
