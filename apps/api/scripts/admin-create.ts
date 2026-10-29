/**
 * Creates a super-admin, or resets the password and authenticator of an existing one.
 * Prints the password and the TOTP secret once: add the secret to an authenticator app
 * (Google Authenticator, Aegis…) and keep the password in a password manager.
 *
 *   pnpm --filter @erp/api admin:create --email you@example.com --name "Islam"
 *   pnpm --filter @erp/api admin:create --email you@example.com --reset
 *
 * Runs as the owner connection (DATABASE_URL_MIGRATE): the admin tables are outside RLS
 * reach of the API role.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { newTotpSecret, otpauthUri } from '../src/admin/totp';
import { PrismaClient } from '../src/generated/prisma/client';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      reset: { type: 'boolean', default: false },
    },
  });
  const email = values.email?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) {
    throw new Error('Usage: admin:create --email you@example.com [--name "Full name"] [--reset]');
  }
  const url = process.env['DATABASE_URL_MIGRATE'] ?? process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL_MIGRATE (or DATABASE_URL) is not set');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  try {
    const password = randomBytes(18).toString('base64url');
    const totpSecret = newTotpSecret();
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const existing = await prisma.platformAdmin.findUnique({ where: { email } });
    if (existing && !values.reset) {
      throw new Error(`${email} already exists. Pass --reset to issue a new password and code.`);
    }
    const admin = await prisma.$transaction(async (tx) => {
      const admin = existing
        ? await tx.platformAdmin.update({
            where: { id: existing.id },
            data: { passwordHash, totpSecret, failedLoginCount: 0, lockedUntil: null },
          })
        : await tx.platformAdmin.create({
            data: { email, fullName: values.name?.trim() || email, passwordHash, totpSecret },
          });
      // A reset closes every open admin session (and the read-only views they opened).
      await tx.platformAdminSession.updateMany({
        where: { adminId: admin.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.platformAuditLog.create({
        data: { adminId: admin.id, action: existing ? 'ADMIN_RESET' : 'ADMIN_CREATED' },
      });
      return admin;
    });

    console.log(`\nSuper-admin ${existing ? 'reset' : 'created'}: ${admin.email}`);
    console.log(`Password (shown once):  ${password}`);
    console.log(`TOTP secret:            ${totpSecret}`);
    console.log(`Authenticator link:     ${otpauthUri(admin.email, totpSecret)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
