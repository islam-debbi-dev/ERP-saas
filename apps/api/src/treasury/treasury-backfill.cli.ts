// One-off after the phase 34 deploy (docs/runbook.md, "Treasury backfill"):
// `pnpm --filter @erp/api treasury:backfill` (after a build), or in the container
// `node dist/treasury/treasury-backfill.cli.js`. Safe to run twice.
import 'dotenv/config';
// Runs once and exits: no nightly reconcile timer in this process.
process.env['RECONCILE_CLI'] = '1';
import '../instrument';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { TreasuryBackfillService } from './treasury-backfill.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const r = await app.get(TreasuryBackfillService).run();
    console.log(
      `Treasury backfill: ${r.linked} rows linked, ${r.movements} movements written over ${r.tenants} tenants.`,
    );
    console.log(
      `Paid at reception, not turned into règlements: ${r.paidAtReception.count} BR, ${r.paidAtReception.total} DA. Enter an opening balance that already accounts for them.`,
    );
  } finally {
    await app.close();
  }
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
