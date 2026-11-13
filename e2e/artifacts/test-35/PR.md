# test: phase 35 client map QA pass (find, not fix)

Branch `test/phase-35-client-map` → `main`. Target of the pass: `ee2df3d` (phase 35 is PR #62).
Open it at <https://github.com/islam-debbi-dev/ERP-saas/compare/main...test/phase-35-client-map?expand=1>.

Full report: [`e2e/REPORT-35.md`](../../REPORT-35.md). This PR adds tests, proofs and the report under
`e2e/` only: `git diff --stat origin/main -- apps packages` is empty. No finding is fixed here.

## What was tested

| Part | Suite | Covers |
|---|---|---|
| A | `e2e/api/map.ts`, `e2e/api/map-props.ts` | `/clients/map`, `/clients/nearby`, `GET /clients?hasLocation=`, `PUT /routes/:id/stops`, `RouteDto.start`: scope per role, tenant isolation with RLS on, the 64 filter combinations, the 2 000 cap, hostile input, radius edges, feature gates, concurrent saves; property tests of `orderByNearest` and `boundingBox`. |
| B | `e2e/api/map-privacy.ts`, `e2e/web/position-privacy.spec.ts`, `e2e/sql/map-privacy.sql` | Where the user's position ends up: pino log, Sentry payloads (local sink), every column of the database, browser storage and outgoing requests. |
| C | `e2e/api/map-perf.ts`, `e2e/web/map-perf.spec.ts` | 145 000 clients in 20 tenants: the SQL the API really runs, `EXPLAIN (ANALYZE, BUFFERS)` as the app role and as the owner, statements per request, times, payload; 2 000 points on a 360 px phone with the CPU slowed ×4 and ×8. |
| D | `e2e/web/map.spec.ts` | Nine browser tests in five projects (360 and 393 px in `ar` and `fr`, 1280 px in `fr`), 120 screenshots. |
| E | `e2e/api/map-index-lock.ts` | How long the migration's `CREATE INDEX` blocks client writes; the deploy step in the README and the runbook. |

Everything runs against the built API and a real PostgreSQL, on local databases made for the pass
(`erp_t35`, `erp_t35_perf`). No mock.

## How to rerun

Setup (databases, the audit stack on :3003 / :3005) is section 2 of the report. Then, from `e2e/`:

```bash
export API=http://localhost:3003 WEB=http://localhost:3005 DB=postgresql://erp:erp@localhost:5432/erp_t35
pnpm test:map:seed     # 4 tenants, 5 000 clients in tenant A
pnpm test:map:api      # part A
pnpm test:map:privacy  # part B
DB=postgresql://erp:erp@localhost:5432/erp_t35_perf pnpm test:map:perf   # part C
pnpm test:map:web      # part D
DB=postgresql://erp:erp@localhost:5432/erp_t35_perf pnpm test:map:lock   # part E
```

These suites are red on purpose: each failing check is the proof of a finding and is named in
section 4 of the report. They are not part of `pnpm test` or of CI.

## Findings: 18 (3 critical, 1 high, 7 medium, 6 low, 1 for the owner to decide)

| # | Severity | Finding |
|---|---|---|
| B-1 | critical | The user's position is sent to Sentry by the API (traces, errors) and by the browser (breadcrumbs) once a DSN is set |
| A-1 | critical by the rule | A livreur sees every client of the company on the map and nearby (spec and code disagree) |
| A-7 | critical by the rule | "Ajouter à une tournée…" silently drops a stop another planner just added |
| A-2 | high | `search` with a NUL byte answers 500 on map, nearby and list |
| A-3 | medium | A seller sees a client outside his scope once it is planned on his route, now with its point |
| B-2 | medium | The log scrub misses `/clients/nearby/` and `/Clients/Nearby` |
| C-1 | medium | The new geo index is never used by the API (row-level security and `numeric`) |
| D-1 | medium | At 360 px the map starts at 59 % of the screen and runs off it |
| D-2 | medium | A failed "Clients proches" is shown as "no client in this radius" |
| D-3 | medium | Picker with "Tous mes clients" above 2 000: "zoomez" loads nothing |
| D-4 | medium | The back button drops unsaved picks without asking |
| A-4 | low, decision | Without `GEO_CHECK` the coordinates still come out of the route DTO |
| A-5 | low | `RouteDto.start` null when the seller's only dépôt has no point |
| A-6 | low | An empty `lat=&lng=` is read as 0, 0 |
| D-5 | low | A position known to ± 5 km is used as if exact |
| D-6 | low | 76 px for the client's name in the nearby list at 360 px |
| E-1 | low | The README's `db:deploy` step does not say which database it migrates |
| B-3 | owner decides | Vercel request logs keep the query string, so the position |

**Go / no-go for the pilot sellers: no-go as it stands, go after PR 1 and PR 2 of the fix plan and the
owner's answer on the livreur** (report, sections 8 and 9).

## Decisions

- **Find, not fix.** Nothing under `apps/` or `packages/` changes; the fix plan (seven small PRs) is
  section 9 of the report and none of them is opened.
- **Severity follows the prompt's rule**, with the context written next to it where the rule is
  harsher than the effect (A-1, A-7) or milder (A-3).
- **RLS on.** The audit API connects as `erp_app`, as production does, not as the owner like the
  local dev stack. This is what made C-1 visible.
- **Audit stack by environment variables only** (`e2e/map-stack.sh`): raised rate limits, a 12 h
  access token. No code change.
- **Production:** two anonymous `GET` requests (`/clients/map`, `/clients/nearby` on the API
  project), both 401. Nothing else was sent.
- **Screenshots are kept at CSS scale** to keep the proof folder at 8 MB.

## Not done

- Neon itself (times are a local floor; the plans carry over), and whether `db:deploy` is still owed
  there: two read-only queries for the owner are in part E.
- Whether production has a Sentry DSN set, and what its Vercel logs hold: needs the owner's accounts.
- A real phone (touch, pinch, on-screen keyboard, real GPS), a screen reader, Safari / Firefox,
  1280 px in Arabic.
- Tenant isolation with RLS off, and a STOREKEEPER on the map (suspected same as A-1).
- Details and reasons: section 7 of the report.
