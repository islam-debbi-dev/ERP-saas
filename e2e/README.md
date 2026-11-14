# e2e audit

End-to-end audit of the ERP SaaS, written against the **real** API and the **real** PostgreSQL
database. No mock, no stub.

**The reports with every finding: [REPORT.md](./REPORT.md) (audit 01, phases 1–11) and
[REPORT-02.md](./REPORT-02.md) (audit 02, the whole project).**

## The suites

| Command | What it runs |
|---|---|
| `pnpm test:api` | `api/scenario.ts` (the business chain) then `api/attacks.ts` (48 attack checks). |
| `pnpm test:db` | `sql/invariants.sql`: 20 invariants read straight from the database. |
| `pnpm test:web` | `web/web.spec.ts`: 10 checks in a real browser (Playwright + Chromium). |
| `pnpm exec tsx api/probe-tx.ts` | The probe that proves finding #1 (`createdAt` vs `xmin`). |

## The targets

The suites talk to a running API and a running web:

```bash
API=http://localhost:3003 pnpm test:api
API=http://localhost:3003 pnpm test:db
WEB=http://localhost:3005 API=http://localhost:3003 pnpm test:web
```

`API` defaults to `http://localhost:3001` and `WEB` to `http://localhost:3000` (`lib/config.ts`);
the web suite defaults to `http://localhost:3005`, the audited web. Always pass them explicitly when
the ports differ.
The web suite needs the Chromium build: `pnpm install:browsers`.

The results are written to `artifacts/` (`*.md` for the humans, `*.json` for the machines).

## Audit 02

Audit 02 runs on its own database (`erp_audit02`), with the API connected as `erp_app` so
row-level security applies. The steps are in the header of `audit-02/part-a.sh`.

| Command | What it runs |
|---|---|
| `pnpm audit02:a` | Part A in order: scenario (the old chain + one chain per module since phase 12, in `api/chains/`), attacks, concurrency, invariants, the repo's reconcile CLI. Add `web` for the browser suite. |
| `pnpm test:concurrency` | `api/concurrency.ts`: 20 requests at once per race (last unit, versements, cash transfers, one Idempotency-Key, payroll approval). |
| `pnpm audit02:routes` | `audit-02/routes.ts`: the list of API routes, read from the controllers. |
| `bash audit-02/baseline.sh` | lint, typecheck, test, build and `pnpm audit --prod` on Node 22. `baseline-rerun.sh` runs the API suites again alone. |

The new suites refuse any database that is not a local `erp_audit02*` (`lib/audit.ts`), and
`AUDIT_RUN=audit-02` sends their summaries to `artifacts/audit-02/` so the proofs of audit 01
are not overwritten. `sql/invariants.sql` now holds 52 blocks, and the runner also tries a
real `UPDATE` and `DELETE` on every ledger (rolled back).

## Notes

- This folder is **not** part of the pnpm workspace: it has its own `package.json` and lockfile, so
  the root `pnpm install` does not touch it (`cd e2e && pnpm install`).
- The web suite creates one tenant for the whole run and shares the browser session. The login
  limiter counts every attempt, successful ones included (finding #3), so a suite that logs in
  for every check would lock itself out.
- `.auth/` (the shared session) and `test-results/` are ignored by git.
