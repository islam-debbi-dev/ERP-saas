/**
 * Demo data: tenant "Grossiste Demo" with an OWNER account.
 * Idempotent (AGENTS.md §7): running it twice changes nothing and never resets a password.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { DEFAULT_EXPENSE_CATEGORIES } from '@erp/shared';
import { EDITION_PRICE_DEFAULTS, PLAN_DEFAULTS } from '../src/billing/plans';
import { createDefaultUnits, ensurePriceLevels } from '../src/catalog/catalog-defaults';
import { PrismaClient } from '../src/generated/prisma/client';

export const DEMO_TENANT_ID = '00000000-0000-4000-8000-00000000d3e0';
export const DEMO_OWNER_EMAIL = 'demo@grossiste.dz';
export const DEMO_SELLER_ID = '00000000-0000-4000-8000-0000000016e1';
export const DEMO_SELLER_EMAIL = 'vendeur@grossiste.dz';
const DEMO_OWNER_PASSWORD = process.env['SEED_OWNER_PASSWORD'] ?? 'Demo1234!';

async function main(): Promise<void> {
  // The owner connection: the seed writes across tenants, outside the RLS policies.
  const url = process.env['DATABASE_URL_MIGRATE'] ?? process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL_MIGRATE (or DATABASE_URL) is not set');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  try {
    await prisma.$transaction(async (tx) => {
      // Plans (phase 13): created if missing, never overwritten (prices may have changed).
      for (const plan of PLAN_DEFAULTS) {
        await tx.plan.upsert({ where: { code: plan.code }, update: {}, create: { ...plan } });
      }
      // Edition supplements (phase 13b): same rule.
      for (const row of EDITION_PRICE_DEFAULTS) {
        await tx.editionPrice.upsert({
          where: { edition: row.edition },
          update: {},
          create: { ...row },
        });
      }

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
          // EXAMPLE timbre values only, left disabled: verify them against the current
          // loi de finances before enabling (README, "Timbre fiscal").
          timbreEnabled: false,
          timbreThreshold: '300.00',
          timbreTranches: [
            { upTo: '30000.00', rate: '1' },
            { upTo: '100000.00', rate: '1.5' },
            { upTo: null, rate: '2' },
          ],
          timbreMin: '5.00',
          timbreMax: '10000.00',
        },
      });

      // Idempotent too: skipDuplicates on the unique keys.
      await createDefaultUnits(tx, tenant.id);
      await ensurePriceLevels(tx, tenant.id, tenant.priceLevelCount);

      // The demo tenant is free, so a dev database never expires into read-only, and has
      // every module (ENTREPRISE) so each screen can be tried.
      const business = await tx.plan.findUniqueOrThrow({ where: { code: 'BUSINESS' } });
      await tx.subscription.upsert({
        where: { tenantId: tenant.id },
        update: {},
        create: {
          tenantId: tenant.id,
          planId: business.id,
          status: 'ACTIVE',
          edition: 'ENTREPRISE',
          isFree: true,
          currentPeriodEnd: new Date(),
        },
      });

      // Sales force demo data (phase 14): one brand and one sector, fixed ids so a rerun
      // changes nothing.
      await tx.brand.upsert({
        where: { id: '00000000-0000-4000-8000-0000000014b1' },
        update: {},
        create: { id: '00000000-0000-4000-8000-0000000014b1', tenantId: tenant.id, name: 'Elio' },
      });
      await tx.sector.upsert({
        where: { id: '00000000-0000-4000-8000-0000000014c1' },
        update: {},
        create: {
          id: '00000000-0000-4000-8000-0000000014c1',
          tenantId: tenant.id,
          name: 'Alger Est',
          wilaya: 'Alger',
          communes: ['Bab Ezzouar', 'Dar El Beïda', 'El Harrach'],
        },
      });

      // Distribution demo data (phase 20): a casier and a 5 % remise on the Elio brand for
      // the year. Fixed ids: a rerun changes nothing.
      await tx.packagingType.upsert({
        where: { id: '00000000-0000-4000-8000-0000000020a1' },
        update: {},
        create: {
          id: '00000000-0000-4000-8000-0000000020a1',
          tenantId: tenant.id,
          name: 'Casier',
          depositValue: '300',
        },
      });
      const year = new Date().getUTCFullYear();
      await tx.promotion.upsert({
        where: { id: '00000000-0000-4000-8000-0000000020b1' },
        update: {},
        create: {
          id: '00000000-0000-4000-8000-0000000020b1',
          tenantId: tenant.id,
          name: 'Elio -5 %',
          type: 'PERCENT_DISCOUNT',
          validFrom: new Date(`${year}-01-01T00:00:00.000Z`),
          validTo: new Date(`${year}-12-31T00:00:00.000Z`),
          target: 'BRAND',
          brandId: '00000000-0000-4000-8000-0000000014b1',
          discountPct: '5',
        },
      });

      // Tournées demo data (phase 16): a seller, three clients of Alger Est and a route
      // that runs every day, so "Ma tournée du jour" has stops. Fixed ids: a rerun changes
      // nothing (the seller's password is never reset).
      await tx.user.upsert({
        where: { id: DEMO_SELLER_ID },
        update: {},
        create: {
          id: DEMO_SELLER_ID,
          tenantId: tenant.id,
          email: DEMO_SELLER_EMAIL,
          passwordHash: await argon2.hash(DEMO_OWNER_PASSWORD, { type: argon2.argon2id }),
          fullName: 'Vendeur Demo',
          role: 'SELLER',
        },
      });
      // Phase 24 (MULTI_UNIT): the demo seller works in every dépôt of the company (the
      // dépôt principal first, as signup creates it).
      await tx.$executeRaw`
        INSERT INTO warehouses ("id", "tenantId", "name", "type", "isDefault", "updatedAt")
        VALUES (gen_random_uuid(), ${tenant.id}::uuid, 'Dépôt principal', 'MAIN', true, CURRENT_TIMESTAMP)
        ON CONFLICT DO NOTHING`;
      await tx.$executeRaw`
        INSERT INTO user_warehouse_access ("id", "tenantId", "userId", "warehouseId", "level", "grantedAt")
        SELECT gen_random_uuid(), w."tenantId", ${DEMO_SELLER_ID}::uuid, w.id, 'OPERATE', CURRENT_TIMESTAMP
        FROM warehouses w
        WHERE w."tenantId" = ${tenant.id}::uuid AND w.type IN ('MAIN', 'SECONDARY')
          AND w."deletedAt" IS NULL
        ON CONFLICT ("userId", "warehouseId") DO NOTHING`;
      // Phase 25 (EXPENSES): the default charge categories and a yearly lease of the dépôt
      // principal, not paid yet (the Loyer block shows it due). No expense is seeded: an
      // expense takes a DEP number.
      await tx.expenseCategory.createMany({
        data: DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ tenantId: tenant.id, ...c })),
        skipDuplicates: true,
      });
      const main = await tx.warehouse.findFirstOrThrow({
        where: { tenantId: tenant.id, isDefault: true },
        select: { id: true },
      });
      await tx.rentContract.upsert({
        where: { id: '00000000-0000-4000-8000-0000000025a1' },
        update: {},
        create: {
          id: '00000000-0000-4000-8000-0000000025a1',
          tenantId: tenant.id,
          warehouseId: main.id,
          landlordName: 'M. Hamdi (propriétaire)',
          landlordPhone: '0550 11 22 33',
          amount: '1200000.00',
          period: 'YEARLY',
          startDate: new Date(`${new Date().getUTCFullYear()}-01-01T00:00:00.000Z`),
        },
      });
      const demoClients = [
        {
          id: '00000000-0000-4000-8000-0000000016c1',
          code: 'TRN-001',
          name: 'Superette El Amel',
          commune: 'Bab Ezzouar',
        },
        {
          id: '00000000-0000-4000-8000-0000000016c2',
          code: 'TRN-002',
          name: 'Alimentation Benali',
          commune: 'Dar El Beïda',
        },
        {
          id: '00000000-0000-4000-8000-0000000016c3',
          code: 'TRN-003',
          name: 'Épicerie du Marché',
          commune: 'El Harrach',
        },
      ];
      for (const c of demoClients) {
        await tx.client.upsert({
          where: { id: c.id },
          update: {},
          create: {
            ...c,
            tenantId: tenant.id,
            wilaya: 'Alger',
            sectorId: '00000000-0000-4000-8000-0000000014c1',
            assignedSellerId: DEMO_SELLER_ID,
          },
        });
      }
      // Géolocalisation demo (phase 17): two of them have a saved point, the third none
      // (its first visit offers to save it). Only set when missing, so a rerun or a point
      // moved by hand stays as it is.
      const demoPoints: Record<string, { lat: number; lng: number }> = {
        'TRN-001': { lat: 36.7213, lng: 3.1846 },
        'TRN-002': { lat: 36.7123, lng: 3.2118 },
      };
      for (const c of demoClients) {
        const point = demoPoints[c.code];
        if (!point) continue;
        await tx.client.updateMany({
          where: { id: c.id, lat: null },
          data: { ...point, geoAccuracyM: 10, geoSetAt: new Date() },
        });
      }
      const route = await tx.route.upsert({
        where: { id: '00000000-0000-4000-8000-0000000016a1' },
        update: {},
        create: {
          id: '00000000-0000-4000-8000-0000000016a1',
          tenantId: tenant.id,
          name: 'Alger Est',
          sellerId: DEMO_SELLER_ID,
          weekdays: [0, 1, 2, 3, 4, 5, 6],
        },
      });
      await tx.routeStop.createMany({
        data: demoClients.map((c, i) => ({
          tenantId: tenant.id,
          routeId: route.id,
          clientId: c.id,
          position: i + 1,
        })),
        skipDuplicates: true,
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
