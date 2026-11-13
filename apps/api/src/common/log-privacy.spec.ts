import { scrubRequest, stripPosition } from './log-privacy';

describe('log privacy (phase 35)', () => {
  it('drops lat and lng from the nearby URL, keeps the rest', () => {
    expect(stripPosition('/clients/nearby?lat=36.75&lng=3.05&radiusM=5000')).toBe(
      '/clients/nearby?radiusM=5000',
    );
    expect(stripPosition('/clients/nearby?lat=36.75&lng=3.05')).toBe('/clients/nearby');
  });

  it('leaves a URL without a position alone', () => {
    expect(stripPosition('/clients?search=lat&limit=50')).toBe('/clients?search=lat&limit=50');
    const req = { method: 'GET', url: '/clients?limit=50', query: { limit: '50' } };
    expect(scrubRequest(req)).toBe(req);
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

  // Express is neither strict nor case-sensitive: these all reach the nearby handler,
  // or are logged like any request (REPORT-35, B-2).
  it.each([
    ['a trailing slash', '/clients/nearby/?lat=36.75&lng=3.05', { lat: '36.75', lng: '3.05' }],
    ['an upper-case path', '/Clients/Nearby?lat=36.75&lng=3.05', { lat: '36.75', lng: '3.05' }],
    ['a path prefix', '/api/v1/clients/nearby?lat=36.75&lng=3.05', { lat: '36.75', lng: '3.05' }],
    ['a doubled slash', '//clients/nearby?lat=36.75&lng=3.05', { lat: '36.75', lng: '3.05' }],
    ['upper-case names', '/clients/nearby?Lat=36.75&Lng=3.05', { Lat: '36.75', Lng: '3.05' }],
    [
      'lat sent twice',
      '/clients/nearby?lat=1&lat=36.75&lng=3.05',
      { lat: ['1', '36.75'], lng: '3.05' },
    ],
  ])('scrubs %s', (_what, url, query) => {
    const out = scrubRequest({ method: 'GET', url, query });
    expect(JSON.stringify(out)).not.toContain('36.75');
    expect(JSON.stringify(out)).not.toContain('3.05');
    expect(out.query).toEqual({});
    expect(out.url).not.toContain('?');
  });

  it('scrubs the view box of the map, centred on the user after "Près de moi"', () => {
    const out = scrubRequest({
      url: '/clients/map?minLat=36.71&minLng=3.02&maxLat=36.9&maxLng=3.3&hasDebt=true',
      query: { minLat: '36.71', minLng: '3.02', maxLat: '36.9', maxLng: '3.3', hasDebt: 'true' },
    });
    expect(out.url).toBe('/clients/map?hasDebt=true');
    expect(out.query).toEqual({ hasDebt: 'true' });
  });
});
