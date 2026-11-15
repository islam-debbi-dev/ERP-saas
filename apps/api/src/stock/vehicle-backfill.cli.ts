// One-off after the phase 36 deploy (docs/runbook.md, "Vehicle backfill"):
// `pnpm --filter @erp/api db:backfill-vehicles` (after a build). Safe to run twice: the
// second run must print 0 and 0.
import 'dotenv/config';
// Runs once and exits: no nightly reconcile timer in this process.
process.env['RECONCILE_CLI'] = '1';
import '../instrument';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { VehicleBackfillService } from './vehicle-backfill.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const r = await app.get(VehicleBackfillService).run();
    console.log(
      [
        `Vehicle backfill over ${r.tenants} tenants.`,
        `Visits given their truck: ${r.visits}.`,
        `Delivered orders given their delivery truck: ${r.orders}.`,
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
