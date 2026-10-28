import { base32Decode, base32Encode, hotp, newTotpSecret, totp, verifyTotp } from './totp';

// RFC 6238 appendix B, SHA-1 key "12345678901234567890" (the 8-digit vectors, last 6 digits).
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));
const VECTORS: [number, string][] = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
  [20000000000, '353130'],
];

describe('TOTP (RFC 6238)', () => {
  it.each(VECTORS)('at %i s the code is %s', (seconds, code) => {
    expect(totp(RFC_SECRET, new Date(seconds * 1000))).toBe(code);
  });

  it('matches the RFC 4226 HOTP vectors', () => {
    const secret = Buffer.from('12345678901234567890');
    expect([0, 1, 2, 9].map((c) => hotp(secret, c))).toEqual([
      '755224',
      '287082',
      '359152',
      '520489',
    ]);
  });

  it('accepts one step of drift either way, not two', () => {
    const at = new Date(1111111111 * 1000);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, new Date(at.getTime() - 30_000)), at)).toBe(
      true,
    );
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, new Date(at.getTime() + 30_000)), at)).toBe(
      true,
    );
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, new Date(at.getTime() - 90_000)), at)).toBe(
      false,
    );
    expect(verifyTotp(RFC_SECRET, 'abcdef', at)).toBe(false);
    expect(verifyTotp(RFC_SECRET, '12345', at)).toBe(false);
  });

  it('base32 round-trips and new secrets are 160 bits', () => {
    const buf = Buffer.from('any bytes ÿ\u0000', 'latin1');
    expect(base32Decode(base32Encode(buf))).toEqual(buf);
    expect(base32Decode(newTotpSecret())).toHaveLength(20);
  });
});
