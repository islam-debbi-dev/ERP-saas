import { describe, expect, it } from 'vitest';
import { scrubSentry, stripLinkTokens } from './sentry-privacy';

const TOKEN = 'k3J9xQ2mVb7Lw0Zt5Yh8Rc1Ne4Ua6Sd_Gf-PoIiTqWe';

describe('stripLinkTokens', () => {
  it.each([
    [`http://localhost:3003/s/${TOKEN}`, 'http://localhost:3003/s/[token]'],
    [`/auth/invitations/${TOKEN}/accept`, '/auth/invitations/[token]/accept'],
    [`GET /auth/invitations/${TOKEN}`, 'GET /auth/invitations/[token]'],
    [
      `https://app.example.dz/invitation/${TOKEN}?lang=ar`,
      'https://app.example.dz/invitation/[token]?lang=ar',
    ],
  ])('%s', (text, clean) => {
    expect(stripLinkTokens(text)).toBe(clean);
  });

  it('leaves the routes and ordinary paths alone', () => {
    for (const text of [
      '/s/:token',
      '/auth/invitations/:token/accept',
      '/sales/quick',
      '/clients/s/1',
    ]) {
      expect(stripLinkTokens(text)).toBe(text);
    }
  });
});

// Shapes copied from the envelopes the audit's Sentry sink received (REPORT-02, B-2).
describe('scrubSentry', () => {
  it('an error event loses the body, the cookies and the Authorization header of its request', () => {
    const event = {
      exception: {
        values: [{ type: 'PrismaClientKnownRequestError', value: 'numeric field overflow' }],
      },
      request: {
        method: 'POST',
        url: 'http://localhost:3013/payments',
        headers: {
          host: 'localhost:3013',
          authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.x.y',
          cookie: 'erp_rt=abc.def',
          'content-length': '178',
        },
        cookies: { erp_rt: 'abc.def' },
        data: '{"clientId":"4bc5af03","mode":"CHEQUE","reference":"CHQ9981","bank":"BNA","amount":"9999999999999999.99"}',
      },
    };
    const sent = JSON.stringify(scrubSentry(event));
    for (const secret of ['CHQ9981', 'BNA', 'eyJhbGci', 'erp_rt', 'abc.def']) {
      expect(sent).not.toContain(secret);
    }
    expect(event.request).toEqual({
      method: 'POST',
      url: 'http://localhost:3013/payments',
      headers: { host: 'localhost:3013', 'content-length': '178' },
    });
    expect(event.exception.values[0]?.value).toBe('numeric field overflow');
  });

  it('a trace span loses http.request.body.data and the cookie header, in both span formats', () => {
    const streamed = {
      name: 'POST /auth/login',
      attributes: {
        'http.request.method': { value: 'POST', type: 'string' },
        'http.request.body.data': {
          value: '{"identifier":"owner@example.dz","password":"Pw-Secret1!"}',
          type: 'string',
        },
        'http.request.header.cookie': { value: ['erp_rt=abc.def'], type: 'array' },
        'http.request.header.authorization': { value: ['Bearer eyJhbGci'], type: 'array' },
        'http.route': { value: '/auth/login', type: 'string' },
      },
    };
    const legacy = {
      description: 'POST /employees/:id/salaries',
      data: {
        'http.request.body.data': '{"amount":"87654.32","payType":"MONTHLY"}',
        'http.request.body.size': 41,
        'url.full': `http://localhost:3013/s/${TOKEN}`,
      },
    };
    const sent = JSON.stringify([scrubSentry(streamed), scrubSentry(legacy)]);
    for (const secret of ['Pw-Secret1!', 'erp_rt', 'eyJhbGci', '87654.32', TOKEN]) {
      expect(sent).not.toContain(secret);
    }
    expect(Object.keys(streamed.attributes)).toEqual(['http.request.method', 'http.route']);
    expect(legacy.data).toEqual({
      'http.request.body.size': 41,
      'url.full': 'http://localhost:3013/s/[token]',
    });
  });

  it('a transaction loses the body of its request and of every span it carries', () => {
    const tx = {
      type: 'transaction',
      transaction: 'POST /admin/auth/login',
      request: {
        url: 'http://localhost:3013/admin/auth/login',
        data: { password: 'Admin-pw', code: '123456' },
      },
      contexts: {
        trace: { data: { 'http.request.body.data': '{"password":"Admin-pw","code":"123456"}' } },
      },
      spans: [{ data: { 'http.request.body.data': '{"password":"Admin-pw"}' } }],
    };
    expect(JSON.stringify(scrubSentry(tx))).not.toMatch(/Admin-pw|123456/);
  });

  it('a breadcrumb and a browser span lose the token of a share or invitation link', () => {
    const crumb = {
      category: 'fetch',
      data: {
        method: 'GET',
        url: `http://localhost:3003/auth/invitations/${TOKEN}`,
        status_code: 200,
      },
    };
    const nav = { category: 'navigation', data: { from: '/login', to: `/invitation/${TOKEN}` } };
    expect(scrubSentry(crumb).data.url).toBe('http://localhost:3003/auth/invitations/[token]');
    expect(scrubSentry(nav).data.to).toBe('/invitation/[token]');
  });

  it('still drops the position (phase 35)', () => {
    const span = {
      data: { 'url.full': 'http://x/clients/nearby?lat=36.7&lng=3.05&limit=5', lat: 36.7 },
    };
    expect(scrubSentry(span)).toEqual({ data: { 'url.full': 'http://x/clients/nearby?limit=5' } });
  });

  it('keeps what an error needs to be understood', () => {
    const event = {
      message: 'boom',
      tags: { route: '/payments' },
      request: { method: 'POST', url: 'http://x/payments', query_string: 'page=2' },
      extra: { data: { rows: 3 } },
    };
    expect(scrubSentry(structuredClone(event))).toEqual(event);
  });
});
