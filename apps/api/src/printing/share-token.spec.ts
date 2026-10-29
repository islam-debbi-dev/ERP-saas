import { hashShareToken, isShareLinkUsable, newShareToken } from './share-token';

describe('share tokens', () => {
  const now = new Date('2026-10-29T10:00:00Z');

  it('opens until the expiry instant, not after', () => {
    expect(
      isShareLinkUsable({ expiresAt: new Date('2026-11-05T10:00:00Z'), revokedAt: null }, now),
    ).toBe(true);
    expect(
      isShareLinkUsable({ expiresAt: new Date('2026-10-29T10:00:00Z'), revokedAt: null }, now),
    ).toBe(false);
    expect(
      isShareLinkUsable({ expiresAt: new Date('2026-10-28T10:00:00Z'), revokedAt: null }, now),
    ).toBe(false);
  });

  it('never opens once revoked, even before expiry', () => {
    expect(
      isShareLinkUsable(
        {
          expiresAt: new Date('2026-11-05T10:00:00Z'),
          revokedAt: new Date('2026-10-29T09:00:00Z'),
        },
        now,
      ),
    ).toBe(false);
  });

  it('stores a hash, not the token', () => {
    const { token, hash } = newShareToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toBe(hashShareToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
  });
});
