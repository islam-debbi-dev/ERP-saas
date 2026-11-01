// One-off after the phase 24 deploy (docs/runbook.md, "Units backfill"):
// `pnpm --filter @erp/api db:backfill-units` (after a build), or in the container
// `node dist/stock/unit-backfill.cli.js`. Safe to run twice. Run it on staging first.
import 'dotenv/config';
// Runs once and exits: no nightly reconcile timer in this process.
process.env['RECONCILE_CLI'] = '1';
import '../instrument';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { UnitBackfillService } from './unit-backfill.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const r = await app.get(UnitBackfillService).run();
    console.log(
      [
        `Units backfill over ${r.tenants} tenants.`,
        `Without a dépôt before: ${JSON.stringify(r.before)}.`,
        `Given a dépôt: ${JSON.stringify(r.filled)}.`,
        `Without a dépôt after: ${JSON.stringify(r.after)}.`,
        `Dépôt access rows created: ${r.accessRows}.`,
        `Client balances before ${r.balancesBefore}, after ${r.balancesAfter}.`,
      ].join('\n'),
    );
  } finally {
    await app.close();
  }
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
