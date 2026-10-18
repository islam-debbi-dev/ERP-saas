import { canonicalJson, requestHash } from './idempotency.service';

describe('idempotency hashing', () => {
  it('ignores key order and undefined values', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: 'x' }, u: undefined })).toBe(
      '{"a":{"c":"x","d":[1,2]},"b":1}',
    );
  });

  it('hashes the same body the same way regardless of key order', () => {
    expect(requestHash('POST', '/x', { a: 1, b: 2 })).toBe(
      requestHash('POST', '/x', { b: 2, a: 1 }),
    );
  });

  it('changes with the body, the method or the path', () => {
    const base = requestHash('POST', '/x', { a: 1 });
    expect(requestHash('POST', '/x', { a: 2 })).not.toBe(base);
    expect(requestHash('POST', '/y', { a: 1 })).not.toBe(base);
    expect(requestHash('PUT', '/x', { a: 1 })).not.toBe(base);
  });
});
