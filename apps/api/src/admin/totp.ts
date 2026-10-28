import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238, SHA-1, 6 digits, 30 s), the codes of Google Authenticator & co.
 * Written here rather than adding a dependency: it is a few lines over node:crypto.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = ALPHABET.indexOf(char);
    if (idx === -1) throw new Error('invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new random secret (160 bits, the RFC's recommended size), base32. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** HOTP (RFC 4226) for one counter value. */
export function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(msg).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return code.toString().padStart(DIGITS, '0');
}

export function totp(secretBase32: string, at: Date = new Date()): string {
  return hotp(base32Decode(secretBase32), Math.floor(at.getTime() / 1000 / TOTP_STEP_SECONDS));
}

/** Accepts the current code and the ones just before and after (phone clock drift). */
export function verifyTotp(secretBase32: string, code: string, at: Date = new Date()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const secret = base32Decode(secretBase32);
  const step = Math.floor(at.getTime() / 1000 / TOTP_STEP_SECONDS);
  let ok = false;
  for (const delta of [-1, 0, 1]) {
    const expected = Buffer.from(hotp(secret, step + delta));
    // Check every window (no early return) so timing says nothing about which matched.
    if (timingSafeEqual(expected, Buffer.from(code))) ok = true;
  }
  return ok;
}

/** The link authenticator apps read (as a QR code or pasted). */
export function otpauthUri(email: string, secretBase32: string): string {
  const issuer = 'ERP Grossiste';
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${email}`)}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
