/**
 * Demo data: tenant "Grossiste Demo" with an OWNER account.
 * Idempotent (AGENTS.md §7): running it twice changes nothing and never resets a password.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { PrismaClient } from '../src/generated/prisma/client';

export const DEMO_TENANT_ID = '00000000-0000-4000-8000-00000000d3e0';
export const DEMO_OWNER_EMAIL = 'demo@grossiste.dz';
const DEMO_OWNER_PASSWORD = process.env['SEED_OWNER_PASSWORD'] ?? 'Demo1234!';

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  try {
    await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.upsert({
        where: { id: DEMO_TENANT_ID },
        update: {},
        create: {
          id: DEMO_TENANT_ID,
          name: 'Grossiste Demo',
          raisonSociale: 'SARL Grossiste Demo',
          adresse: 'Zone d’activité, Oued Smar, Alger',
          telephone: '023 00 00 00',
          assujettiTva: true,
        },
      });

      const existing = await tx.user.findUnique({ where: { email: DEMO_OWNER_EMAIL } });
      if (existing) {
        console.log(`Seed: ${DEMO_OWNER_EMAIL} already exists, nothing to do.`);
        return;
      }

      const owner = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: DEMO_OWNER_EMAIL,
          passwordHash: await argon2.hash(DEMO_OWNER_PASSWORD, { type: argon2.argon2id }),
          fullName: 'Propriétaire Demo',
          role: 'OWNER',
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          userId: owner.id,
          action: 'SEED_DEMO_TENANT',
          entity: 'Tenant',
          entityId: tenant.id,
          after: { name: tenant.name, ownerEmail: owner.email },
        },
      });
      console.log(`Seed: created "${tenant.name}" with owner ${DEMO_OWNER_EMAIL}.`);
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
