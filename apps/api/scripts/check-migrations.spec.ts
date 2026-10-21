import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { findDestructive } from './check-migrations';

const rules = (sql: string) => findDestructive(sql).map((f) => f.rule);

describe('findDestructive', () => {
  it('accepts expand-only changes', () => {
    expect(
      rules(`
CREATE TABLE "x" ("id" UUID NOT NULL, CONSTRAINT "x_pkey" PRIMARY KEY ("id"));
ALTER TABLE "users" ADD COLUMN "phone" TEXT;
ALTER TABLE "users" ADD COLUMN "flags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "users" DROP CONSTRAINT "users_email_key";
DROP INDEX "users_email_idx";
CREATE INDEX "a_idx" ON "a"("tenantId");
CREATE FUNCTION f() RETURNS trigger AS $$
BEGIN
  DELETE FROM t; RAISE EXCEPTION 'no';
END;
$$ LANGUAGE plpgsql;
ALTER TABLE "t" ENABLE ROW LEVEL SECURITY;`),
    ).toEqual([]);
  });

  it.each([
    ['DROP TABLE "old";', 'drop'],
    ['ALTER TABLE "p" DROP COLUMN "name";', 'drop'],
    ['ALTER TABLE "p" DROP "name";', 'drop'],
    ['ALTER TABLE "p" RENAME COLUMN "a" TO "b";', 'rename'],
    ['ALTER TABLE "p" RENAME TO "q";', 'rename'],
    ['ALTER TABLE "p" ALTER COLUMN "qty" SET DATA TYPE DECIMAL(14,3);', 'change-type'],
    ['ALTER TABLE "p" ALTER COLUMN "qty" TYPE INTEGER;', 'change-type'],
    ['ALTER TABLE "p" ALTER COLUMN "code" SET NOT NULL;', 'set-not-null'],
    ['ALTER TABLE "p" ADD COLUMN "code" TEXT NOT NULL;', 'add-required-column'],
    ['DELETE FROM "sessions";', 'delete-data'],
    ['TRUNCATE "sessions";', 'delete-data'],
  ])('flags %s', (sql, rule) => {
    expect(rules(sql)).toEqual([rule]);
  });

  it('accepts a destructive statement with a reason on the line above', () => {
    const sql = `
-- destructive-ok: column unused since release 2026-11
ALTER TABLE "p" DROP COLUMN "name";

ALTER TABLE "p" DROP COLUMN "other";`;
    expect(findDestructive(sql)).toEqual([
      { line: 5, rule: 'drop', statement: 'ALTER TABLE "p" DROP COLUMN "other";' },
    ]);
  });

  it('needs a reason after the marker', () => {
    expect(rules('-- destructive-ok:\nDROP TABLE "x";')).toEqual(['drop']);
  });

  it('passes on the repo migrations and fails on a destructive fixture (CLI)', () => {
    const script = path.join(__dirname, 'check-migrations.ts');
    const tsx = path.join(__dirname, '..', 'node_modules', '.bin', 'tsx');
    expect(execFileSync(tsx, [script], { encoding: 'utf8' })).toMatch(/backward compatible/);

    const dir = mkdtempSync(path.join(os.tmpdir(), 'migrations-'));
    mkdirSync(path.join(dir, '20990101000000_bad'));
    writeFileSync(path.join(dir, '20990101000000_bad', 'migration.sql'), 'DROP TABLE "clients";\n');
    expect(() => execFileSync(tsx, [script, dir], { stdio: 'pipe' })).toThrow(/destructive/);
  });
});
