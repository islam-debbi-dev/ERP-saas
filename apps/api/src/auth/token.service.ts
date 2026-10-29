import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import type { AccessTokenPayload } from './auth.types';

/**
 * Refresh tokens are opaque: `<sessionId>.<secret>`. The secret is 32 random bytes, so a
 * fast sha256 is enough to store it (argon2 is for low-entropy passwords).
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** How long the previous refresh token stays usable after a rotation. */
  get reuseGraceSeconds(): number {
    return this.config.REFRESH_REUSE_GRACE_SECONDS;
  }

  get accessTtlSeconds(): number {
    return this.config.ACCESS_TOKEN_TTL_SECONDS;
  }

  refreshExpiry(from: Date = new Date()): Date {
    return new Date(from.getTime() + this.config.REFRESH_TOKEN_TTL_DAYS * 24 * 3600 * 1000);
  }

  signAccess(payload: AccessTokenPayload): Promise<string> {
    return this.jwt.signAsync(payload, { expiresIn: this.config.ACCESS_TOKEN_TTL_SECONDS });
  }

  verifyAccess(token: string): Promise<AccessTokenPayload> {
    return this.jwt.verifyAsync<AccessTokenPayload>(token);
  }

  newRefreshSecret(): { secret: string; hash: string } {
    const secret = TokenService.newSecret();
    return { secret, hash: TokenService.hash(secret) };
  }

  /** 32 random bytes, base64url: refresh tokens and one-time links. */
  static newSecret(): string {
    return randomBytes(32).toString('base64url');
  }

  static hash(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }

  static formatRefreshToken(sessionId: string, secret: string): string {
    return `${sessionId}.${secret}`;
  }

  static parseRefreshToken(token: string): { sessionId: string; secret: string } | null {
    const dot = token.indexOf('.');
    if (dot <= 0) return null;
    const sessionId = token.slice(0, dot);
    const secret = token.slice(dot + 1);
    if (!/^[0-9a-f-]{36}$/i.test(sessionId) || secret.length < 20) return null;
    return { sessionId, secret };
  }

  /** Constant-time comparison of two hex sha256 hashes. */
  static sameHash(a: string, b: string): boolean {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  }
}
