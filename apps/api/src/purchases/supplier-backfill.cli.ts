// One-off after the phase 21 deploy (docs/runbook.md, "Supplier ledger backfill"):
// `pnpm --filter @erp/api db:backfill-supplier-ledger` (after a build), or in the
// container `node dist/purchases/supplier-backfill.cli.js`. Safe to run twice.
import 'dotenv/config';
// Runs once and exits: no nightly reconcile timer in this process.
process.env['RECONCILE_CLI'] = '1';
import '../instrument';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { SupplierBackfillService } from './supplier-backfill.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const result = await app.get(SupplierBackfillService).run();
    console.log(
      `Supplier ledger backfill: ${result.purchases} BR and ${result.returns} retours posted over ${result.tenants} tenants.`,
    );
  } finally {
    await app.close();
  }
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
