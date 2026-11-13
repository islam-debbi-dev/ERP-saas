import { describe, expect, it } from 'vitest';
import { scrubPosition, stripPositionParams } from './position-privacy';

describe('stripPositionParams', () => {
  it('drops lat and lng, keeps the rest, in any order', () => {
    expect(stripPositionParams('/clients/nearby?lat=36.75&lng=3.05&radiusM=5000')).toBe(
      '/clients/nearby?radiusM=5000',
    );
    expect(stripPositionParams('/clients/nearby?radiusM=5000&lat=36.75&lng=3.05')).toBe(
      '/clients/nearby?radiusM=5000',
    );
    expect(stripPositionParams('/clients/nearby?lat=36.75&limit=30&lng=3.05')).toBe(
      '/clients/nearby?limit=30',
    );
    expect(stripPositionParams('/clients/nearby?lat=36.75&lng=3.05')).toBe('/clients/nearby');
  });

  it('keeps the encoding of the other parameters', () => {
    expect(
      stripPositionParams('/clients/nearby?hasDebt=true&search=caf%C3%A9&lat=36.71&lng=3.02'),
    ).toBe('/clients/nearby?hasDebt=true&search=caf%C3%A9');
    expect(stripPositionParams('lat=36.710685&lng=3.020755&search=%00')).toBe('search=%00');
  });

  // The spellings the router accepts and the first scrub missed (REPORT-35, B-2).
  it.each([
    ['/clients/nearby/?lat=36.710959&lng=3.021057', '/clients/nearby/'],
    ['/Clients/Nearby?lat=36.711096&lng=3.021208', '/Clients/Nearby'],
    ['//clients/nearby?lat=36.711233&lng=3.021359', '//clients/nearby'],
    ['/clients%2Fnearby?lat=36.711370&lng=3.021510', '/clients%2Fnearby'],
    ['/clients/nearby?lat=1&lat=36.711507&lng=3.021661', '/clients/nearby'],
    ['/clients/nearby?Lat=36.711644&Lng=3.021812&lat=1&lng=1', '/clients/nearby'],
    ['/clients/nearby;x=1?lat=36.711781&lng=3.021963', '/clients/nearby;x=1'],
    ['/v1/clients/nearby?lat=36.7&lng=3.0&limit=5', '/v1/clients/nearby?limit=5'],
    [
      'http://localhost:3013/api/clients/nearby?lat=36.7&lng=3.0#x',
      'http://localhost:3013/api/clients/nearby#x',
    ],
  ])('%s', (url, clean) => {
    expect(stripPositionParams(url)).toBe(clean);
  });

  it('drops the view box of the map', () => {
    expect(
      stripPositionParams(
        '/clients/map?minLat=36.71&minLng=3.02&maxLat=36.9&maxLng=3.3&hasDebt=true',
      ),
    ).toBe('/clients/map?hasDebt=true');
  });

  it('leaves everything else alone', () => {
    for (const s of [
      '/clients?search=lat',
      '/clients?flat=1&relat=2',
      '/products?template=3',
      'GET /clients/nearby',
      'Is this late? Yes.',
      '',
    ]) {
      expect(stripPositionParams(s)).toBe(s);
    }
  });
});

describe('scrubPosition', () => {
  const has = (v: unknown, ...needles: string[]): boolean =>
    needles.some((n) => JSON.stringify(v).includes(n));

  // Shapes recorded by the phase 35 test pass (e2e/artifacts/test-35/privacy-log-and-sentry.md).
  it('API error event: request.url and request.query_string', () => {
    const event = {
      transaction: 'GET /clients/nearby',
      request: {
        method: 'GET',
        url: 'http://localhost:3013/clients/nearby?lat=36.710685&lng=3.020755&search=%00',
        query_string: 'lat=36.710685&lng=3.020755&search=%00',
        headers: { host: 'localhost:3013' },
      },
      user: { ip_address: '::1' },
    };
    const out = scrubPosition(event);
    expect(out).toBe(event);
    expect(has(out, '36.710685', '3.020755')).toBe(false);
    expect(out.request.url).toBe('http://localhost:3013/clients/nearby?search=%00');
    expect(out.request.query_string).toBe('search=%00');
    expect(out.request.headers.host).toBe('localhost:3013');
  });

  it('query string given as an object or as pairs', () => {
    const asObject = { request: { query_string: { lat: '36.71', Lng: '3.02', limit: '30' } } };
    expect(scrubPosition(asObject).request.query_string).toEqual({ limit: '30' });
    const asPairs = {
      request: { query_string: [['limit', '30']], data: { lat: 36.71, lng: 3.02 } },
    };
    expect(has(scrubPosition(asPairs), '36.71', '3.02')).toBe(false);
  });

  it('streamed span: url.full, url.query and the name', () => {
    const span = {
      name: 'GET /api/clients/nearby?lat=36.710137&lng=3.020151',
      is_segment: true,
      attributes: {
        'http.route': '/clients/nearby',
        'url.full': '/clients/nearby?lat=36.710137&lng=3.020151&radiusM=5000&limit=30',
        'url.query': { value: 'lat=36.710137&lng=3.020151', type: 'string' },
        'sentry.sample_rate': 0.1,
      },
    };
    const out = scrubPosition(span);
    expect(has(out, '36.710137', '3.020151')).toBe(false);
    expect(out.attributes['url.full']).toBe('/clients/nearby?radiusM=5000&limit=30');
    expect(out.attributes['http.route']).toBe('/clients/nearby');
    expect(out.attributes['sentry.sample_rate']).toBe(0.1);
    expect(out.name).toBe('GET /api/clients/nearby');
  });

  it('browser fetch breadcrumb', () => {
    const crumb = {
      category: 'fetch',
      data: {
        method: 'GET',
        status_code: 200,
        url: 'https://app.example/api/clients/nearby?lat=36.732366&lng=3.088926&radiusM=5000&limit=50',
      },
    };
    expect(scrubPosition(crumb).data.url).toBe(
      'https://app.example/api/clients/nearby?radiusM=5000&limit=50',
    );
  });

  it('survives cycles, class instances and non-objects', () => {
    const cyclic: Record<string, unknown> = { url: '/x?lat=1&lng=2' };
    cyclic['self'] = cyclic;
    expect(scrubPosition(cyclic)['url']).toBe('/x');
    const date = new Date(0);
    expect(scrubPosition({ at: date }).at).toBe(date);
    expect(scrubPosition(null)).toBeNull();
    expect(scrubPosition(42)).toBe(42);
  });
});
