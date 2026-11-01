Read AGENTS.md, docs/architecture.md and docs/runbook.md fully before doing anything. Read `infra/deploy/` (compose, Caddy, scripts), `infra/postgres/`, `.github/workflows/deploy.yml` and `apps/api/src/config`.

## Task: Phase 23 — Move production from Vercel + Neon to the VPS

Branch: `phase-23-vps-cutover`. Phases 1–22 are merged. No feature flag. No new business feature: this phase makes the phase 12 VPS stack current and moves the live data onto it without losing one row.

Why now: Vercel Hobby is not allowed for commercial use, Puppeteer PDFs do not run there, in-process jobs (`ReconcileService`, `ImportFilesJanitor`) need a long-running process, and phases 27–28 add scheduled WhatsApp jobs. From this phase on, the VPS is the only production target.

### Part A — make the VPS stack current (code, one commit each)
1. Audit every env var read by `apps/api/src/config` and the web against `infra/deploy/env.example`, `infra/.env.stack.example` and `.env.example`. Add what phases 13–22 introduced, with a one-line comment each. A missing required var must fail at boot with a clear message (it already does through the config schema: check it covers the new ones).
2. Check that `infra/deploy/compose.yml` still builds and runs every image the code needs (Chromium for PDFs, the share-link public route, the import upload folder on a volume, the super-admin CLI). Fix what drifted.
3. **Jobs on one process only.** Wrap every in-process scheduled job (reconcile, janitor, and the future ones) in a shared helper `runExclusive(name, fn)` that takes `pg_try_advisory_lock(hashtext(name))` on the owner connection and skips when another replica holds it. Unit test it with two concurrent callers.
4. **RLS ready for a pooler.** `apps/api/src/prisma/tenant-pool.ts` sets `app.tenant_id` / `app.rls_bypass` with session-level `set_config(..., false)` on each checkout, which forbids PgBouncer in transaction mode. Change it so the tenant is set per transaction (`set_config(..., true)` inside the transaction that runs the queries; wrap the queries that today run outside an explicit transaction). Keep the current behaviour as the fallback until every path is covered. Integration test: with a pool of 1 connection, request A (tenant A) then request B (tenant B) never sees A's rows, and a query run without a tenant fails closed. Do not add PgBouncer yet; document in the runbook when to (about 50 active companies or when connections near `max_connections`).
5. **Monitoring.** Enable `pg_stat_statements` and `log_min_duration_statement = 500ms` in the production Postgres image; add a runbook section "Slow queries" (how to read the top 20 by total time, how to check a query plan, the rule that every new index starts with `tenantId`).
6. `apps/web/vercel.json` and `apps/api/vercel.json` stay in the repo for now (deleted in a later release, AGENTS §7 spirit), but the README and runbook say production is the VPS.

### Part B — the data move (a runbook section plus scripts, no app code)
Write `infra/scripts/migrate-from-neon.sh` and a runbook section "Move from Neon to the VPS". The script must:
- refuse to run unless `SOURCE_URL` (Neon, direct non-pooler, owner) and the target stack are set; never take a URL as a literal argument that ends in shell history;
- check both sides run the same migration list (`_prisma_migrations`), abort otherwise;
- `pg_dump --format=custom --no-owner --no-acl` from Neon, then `pg_restore` into the empty production db **as the owner** (`erp`), then re-apply grants for `erp_app` and check RLS is on for every `tenantId` table (reuse the query of the rls integration test);
- compare row counts for every table and the sums of every ledger and cached balance (client, supplier, stock, packaging) between source and target; print a table; exit non-zero on any difference;
- run `reconcile` on the target; it must say "no difference".

Cut-over order in the runbook (islam runs it, on a quiet evening):
1. Announce a 30 min window to the companies. 2. Put Vercel in maintenance (unset `DATABASE_URL` on the Vercel API project so it refuses writes) and wait 2 minutes. 3. Run the script. 4. Point DNS `app.<domain>` to the VPS, deploy, smoke test login, a sale, a versement, a PDF. 5. Take a WAL-G base backup `--now` and run the restore drill once. 6. Keep Neon read-only for 14 days, then delete it.
Rollback before step 4: just set `DATABASE_URL` back on Vercel. After step 4 there is no going back to Neon; problems are fixed forward on the VPS.

### Tests
- Unit: `runExclusive` (only one of two concurrent callers runs; the lock is released after an error).
- Integration: the comparison part of the script runs in CI against two local databases (`db_test` and a second throwaway one restored from a dump of it) and reports equal; corrupt one balance on purpose and it must exit non-zero.
- CI deploy workflow still green (lint, typecheck, test, build, migration check, restore drill).

### Not in this phase
Kubernetes, managed Postgres, a second VPS for high availability, CDN (parked).

### Definition of done
AGENTS.md §10. Summary ends with What / How to test manually / Decisions / Next phase (24 Dépôts: équipes et accès). In the summary, list the exact commands islam runs on cut-over night.
