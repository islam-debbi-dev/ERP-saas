// One-off after the phase 15 deploy (docs/runbook.md, "Warehouse backfill"):
// `pnpm --filter @erp/api db:backfill-warehouses` (after a build), or in the container
// `node dist/stock/warehouse-backfill.cli.js`. Safe to run twice. Run it on staging first.
import 'dotenv/config';
// Runs once and exits: no nightly reconcile timer in this process.
process.env['RECONCILE_CLI'] = '1';
import '../instrument';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { WarehouseBackfillService } from './warehouse-backfill.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const r = await app.get(WarehouseBackfillService).run();
    console.log(
      [
        `Warehouse backfill over ${r.tenants} tenants.`,
        `Rows given the main dépôt: ${JSON.stringify(r.filled)}.`,
        `Main dépôt stock rows created: ${r.stockRows}.`,
        `Company stock before ${r.totalBefore}, after ${r.totalAfter}.`,
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
