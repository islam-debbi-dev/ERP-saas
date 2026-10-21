# e2e audit

End-to-end audit of the ERP SaaS, written against the **real** API and the **real** PostgreSQL
database. No mock, no stub.

**The report with every finding: [REPORT.md](./REPORT.md).**

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

## Notes

- This folder is **not** part of the pnpm workspace: it has its own `package.json` and lockfile, so
  the root `pnpm install` does not touch it (`cd e2e && pnpm install`).
- The web suite creates one tenant for the whole run and shares the browser session. The login
  limiter counts every attempt, successful ones included (finding #3), so a suite that logs in
  for every check would lock itself out.
- `.auth/` (the shared session) and `test-results/` are ignored by git.
