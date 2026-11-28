// One-off after the phase 40a deploy (docs/runbook.md, "Commune backfill"). Back up the
// database first. `pnpm --filter @erp/api db:backfill-communes [--out <file.csv>]` (after a
// build). Safe to run twice: the second run must change 0 clients.
import 'dotenv/config';
// Runs once and exits: no nightly reconcile timer in this process.
process.env['RECONCILE_CLI'] = '1';
import '../instrument';
import 'reflect-metadata';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { CommuneBackfillService } from './commune-backfill.service';
import { backfillToCsv } from './commune-backfill.report';

async function main(): Promise<void> {
  // pnpm passes a `--` through.
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const { values } = parseArgs({ args, options: { out: { type: 'string' } } });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.resolve(values.out ?? `communes-backfill-${stamp}.csv`);
  // `wx`: an existing report is never overwritten. Opened before anything is written, so
  // that a report that cannot be written stops the run before it changes a client.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const r = await backfillToCsv(app.get(CommuneBackfillService), out);
    console.log(
      [
        `Commune backfill over ${r.tenants} tenants.`,
        `Clients changed: ${r.changed}.`,
        `Clients with a text left without codes: ${r.unmatched}.`,
        `Clients to check, listed in ${out}: ${r.listed}.`,
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
