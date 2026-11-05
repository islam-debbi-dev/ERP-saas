import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ErrorCode } from '@erp/shared';
import { AppException } from '../app-exception';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

/**
 * API keys and tokens at rest (phase 30; phase 27 reuses it for the WhatsApp token).
 * AES-256-GCM with `SECRETS_ENCRYPTION_KEY` (32 bytes, base64). `context` is bound as
 * additional data: a box copied onto another company's row does not open.
 */
export function parseSecretsKey(base64: string | undefined): Buffer {
  const key = base64 ? Buffer.from(base64, 'base64') : Buffer.alloc(0);
  if (key.length !== KEY_BYTES) {
    throw new AppException(
      ErrorCode.SECRETS_KEY_UNAVAILABLE,
      'SECRETS_ENCRYPTION_KEY must be 32 bytes in base64',
    );
  }
  return key;
}

export function sealSecret(key: Buffer, plaintext: string, context: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), data].map(encodePart).join('.');
}

/** Throws on a wrong key, a changed box or another context; never returns garbage. */
export function openSecret(key: Buffer, box: string, context: string): string {
  const [version, iv, tag, data] = box.split('.');
  if (version !== VERSION || !iv || !tag || data === undefined) {
    throw new AppException(ErrorCode.SECRETS_KEY_UNAVAILABLE, 'Unreadable secret');
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString(
      'utf8',
    );
  } catch {
    throw new AppException(ErrorCode.SECRETS_KEY_UNAVAILABLE, 'Unreadable secret');
  }
}

function encodePart(part: string | Buffer): string {
  return typeof part === 'string' ? part : part.toString('base64');
}
