import { TOWNS, farFrom, haversineM, nearTo, orderByProximity, pointInTown, rng } from './gps.js';

describe('seed-field gps', () => {
  it('gives the same points for the same seed', () => {
    const a = pointInTown(TOWNS['msila']!, rng(28_001));
    const b = pointInTown(TOWNS['msila']!, rng(28_001));
    expect(a).toEqual(b);
    expect(pointInTown(TOWNS['msila']!, rng(28_002))).not.toEqual(a);
  });

  it('keeps every point inside its town disc and inside the wilaya', () => {
    for (const town of Object.values(TOWNS)) {
      for (let i = 1; i <= 200; i++) {
        const p = pointInTown(town, rng(i));
        expect(haversineM(p, town.centre)).toBeLessThanOrEqual(town.radiusM + 5);
        expect(p.lat).toBeGreaterThan(34.5);
        expect(p.lat).toBeLessThan(36.2);
        expect(p.lng).toBeGreaterThan(3.3);
        expect(p.lng).toBeLessThan(5.3);
      }
    }
  });

  it('makes a far position well beyond the 150 m radius and a near one inside it', () => {
    const c = TOWNS['bousaada']!.centre;
    expect(haversineM(c, farFrom(c))).toBeGreaterThan(1000);
    expect(haversineM(c, nearTo(c, rng(3)))).toBeLessThan(40);
  });

  it('orders stops by nearest neighbour from the start', () => {
    const start = { lat: 35, lng: 4 };
    const items = [
      { id: 'far', point: { lat: 35.05, lng: 4 } },
      { id: 'near', point: { lat: 35.001, lng: 4 } },
      { id: 'mid', point: { lat: 35.02, lng: 4 } },
    ];
    expect(orderByProximity(items, start).map((x) => x.id)).toEqual(['near', 'mid', 'far']);
  });
});
