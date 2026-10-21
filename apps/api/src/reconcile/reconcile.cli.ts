// By hand: `pnpm --filter @erp/api reconcile` (after a build), or in the container
// `node dist/reconcile/reconcile.cli.js`. Exit code 1 when a ledger disagrees.
import 'dotenv/config';
import '../instrument';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ReconcileService } from './reconcile.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const result = await app.get(ReconcileService).run();
    if (!result.ran) {
      console.error('Another reconcile is running; try again later.');
      process.exitCode = 2;
    } else if (result.mismatches.length > 0) {
      console.table(result.mismatches);
      process.exitCode = 1;
    } else {
      console.log('Ledgers reconciled: no difference.');
    }
  } finally {
    await app.close();
  }
}

void main();
