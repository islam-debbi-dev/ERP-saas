Read AGENTS.md and docs/architecture.md (Infra) before doing anything.

## Task: Phase 12 — Production readiness

Branch: `phase-12-production`. All MVP phases are merged. Goal: no data loss, fast recovery, and a deploy you can trust. 100% uptime doesn't exist; losing a client's credit book is not acceptable.

### Deploy
- Production Dockerfiles for api and web (multi-stage, non-root user, healthcheck).
- Two environments: **staging** and **production**, same images, different env.
- Hosting: pick one and justify in Decisions (a VPS with Docker Compose + Caddy for TLS is the default for cost; a managed platform is fine if cheaper to operate). Postgres must be **managed** or have automated backups configured by you, with point-in-time recovery.
- CI/CD: on merge to main → lint, typecheck, test, build images → run `prisma migrate deploy` on staging → deploy staging → smoke test `/health` → manual approval → same for production.
- Migrations must be backward compatible (expand → migrate → contract). Add a CI check that fails on destructive migrations without an explicit marker.

### Data safety
- Daily full backups + WAL/PITR, retention 30 days, stored off the DB host (S3-compatible bucket, encrypted).
- `infra/scripts/restore-drill.sh`: restores the latest backup into a scratch DB and runs a sanity query (row counts, ledger reconcile). Document a **monthly restore drill** in `docs/runbook.md`.
- Ledger reconcile job (stock + client balances) runs nightly and alerts on any difference.

### Security
- Postgres **Row-Level Security** on all tenant tables as defense in depth: `SET LOCAL app.tenant_id` per transaction from the Prisma extension; policies `tenant_id = current_setting('app.tenant_id')`. Tests prove a query without the setting returns nothing.
- Rate limiting (global + stricter on auth), helmet/security headers, CORS restricted to the web origin, request size limits, secrets only from env.
- Dependency audit in CI (`pnpm audit --prod`, fail on high).
- Run the `/security-review` pass and fix findings.

### Monitoring
- Sentry for api and web (DSN via env), release tagging.
- Uptime monitor on `/health` (BetterStack or UptimeRobot) with alerts by email/SMS.
- Structured pino logs shipped somewhere searchable; request id on every log line and error response.

### Docs
- `docs/runbook.md`: deploy, rollback, restore, rotate secrets, what to do if the DB is down, how to reconcile ledgers.

### Tests
- RLS isolation tests; migration check script tested; restore drill script runs in CI against a throwaway DB.

### Definition of done
AGENTS.md §10, staging deployed and reachable, one successful restore drill documented in the PR. Summary ends with What / How to test / Decisions / Next phase (Pilot & billing).
