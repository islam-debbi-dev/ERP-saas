import { createHash, randomBytes } from 'node:crypto';

/** 32 random bytes: the token travels in the URL and is never stored in clear. */
export function newShareToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashShareToken(token) };
}

export function hashShareToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A link opens until it expires or is revoked, whichever comes first. */
export function isShareLinkUsable(
  link: { expiresAt: Date; revokedAt: Date | null },
  now: Date = new Date(),
): boolean {
  return link.revokedAt === null && link.expiresAt.getTime() > now.getTime();
}
