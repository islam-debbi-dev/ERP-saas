import { scrubRequest, stripPosition } from './log-privacy';

describe('log privacy (phase 35)', () => {
  it('drops lat and lng from the nearby URL, keeps the rest', () => {
    expect(stripPosition('/clients/nearby?lat=36.75&lng=3.05&radiusM=5000')).toBe(
      '/clients/nearby?radiusM=5000',
    );
    expect(stripPosition('/clients/nearby?lat=36.75&lng=3.05')).toBe('/clients/nearby');
  });

  it('leaves other routes alone', () => {
    expect(stripPosition('/clients/map?minLat=36&lat=1')).toBe('/clients/map?minLat=36&lat=1');
    expect(stripPosition('/clients/nearbyx?lat=1')).toBe('/clients/nearbyx?lat=1');
  });

  it('scrubs the serialized request url and query', () => {
    const out = scrubRequest({
      method: 'GET',
      url: '/clients/nearby?lat=36.75&lng=3.05&limit=30',
      query: { lat: '36.75', lng: '3.05', limit: '30' },
    });
    expect(out.url).toBe('/clients/nearby?limit=30');
    expect(out.query).toEqual({ limit: '30' });
    expect(JSON.stringify(out)).not.toContain('36.75');
  });
});
