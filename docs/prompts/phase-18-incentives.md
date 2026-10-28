Read AGENTS.md and docs/domain.md (Sales force & distribution → Objectifs & primes) before doing anything. Read `packages/shared/src/periods.ts` and `packages/shared/src/money.ts`.

## Task: Phase 18 — Objectifs & primes (configurable per company)

Branch: `phase-18-incentives`. Phases 1–14 are merged (recommended: 17 too, for GPS gates). Feature flag: `INCENTIVES`.

### Goal
Each company sets monthly targets for its sellers and sales managers and its own bonus rules, from screens, without code. The app shows live progress to each seller and, at month end, computes the bonuses with a line-by-line explanation for the owner to approve. We compute the amount; we do **not** run payroll (export only).

### Domain rules to respect
- **Metrics** (all from data that already exists, by seller = `Sale.sellerId` / `Payment.collectedBy`, period boundaries in `Africa/Algiers` via `periods.ts`):
  - `CA_HT`: validated BL and factures HT (a facture made from BLs is counted once), minus validated avoirs HT, by validation date. An avoir counts in the month it is validated, so a return after an approved month lowers the next month (natural clawback, no rewrite of the past).
  - `QTY`: base-unit quantity sold minus returned; optional display unit (carton).
  - `ENCAISSEMENT`: valid versements collected, minus cancelled/bounced ones in the month they are reversed.
  - `MARGE`: CA HT − cost at the frozen CUMP of the lines (only with `VIEW_COST_AND_MARGIN`).
  - `NEW_CLIENTS`: clients whose first ever validated sale is in the period.
  - `VISITS`, `STRIKE_RATE`: only if phase 16 (visits) is merged; otherwise leave them out of the metric list, phase 16 adds them.
  - `RECOUVREMENT_PCT`: ENCAISSEMENT ÷ credit part of the seller's sales of the period (TTC − paid at sale), as a percentage; 100 when there was no credit.
  - `GEO_FLAGS`: GeoChecks reviewed `NOT_JUSTIFIED`; only if phase 17 is merged, same rule.
  - Every metric accepts a scope filter: brandId, categoryId, productId (not for money-only metrics where it makes no sense: refuse).
- **Targets**: `SalesTarget` (tenantId, period start, userId **or** teamManagerId, metric, scope, targetValue). Team target = sum over the manager's whole subtree (recursive CTE on `User.managerId`). Bulk entry screen (one row per seller, copy last month, +x %).
- **Plans and rules**: `IncentivePlan` (name, period `MONTH` / `QUARTER`, validFrom, validTo, status `DRAFT` / `ACTIVE` / `ARCHIVED`, version). An ACTIVE plan is never edited: "modify" creates a new version with a new validFrom. `IncentiveRule` (planId, appliesTo `ROLE` / `USER` / `TEAM_MANAGER`, roleOrUserId, `params Json`).
- `params` is a zod **discriminated union** in `packages/shared/src/incentives.ts` (amounts are decimal strings, never numbers):
  1. `FIXED_ON_TARGET`: { metric, scope?, minPct, amount }.
  2. `TIERS`: { metric, scope?, mode `HIGHEST_REACHED` | `PROGRESSIVE`, tiers [{ fromPct, amount } | { fromPct, ratePct }] }.
  3. `COMMISSION`: { metric (money), scope?, ratePct, onlyAbovePct? }.
  4. `PER_UNIT`: { scope (required), amountPerUnit, unit? }.
  5. `MANAGER_OVERRIDE`: { metric, ratePct of the team's achieved value | amount when team reaches minPct }.
  - Plus on any rule: `gates` [{ metric, min? , max? }] (e.g. RECOUVREMENT_PCT ≥ 70, GEO_FLAGS ≤ 3) and `cap` (max amount).
- **Pure engine**: `evaluateRule(params, metrics, target) → { amount, explanation }` in `packages/shared`, no DB access, heavy unit tests. `explanation` is structured data (achieved, target, pct, tier reached, gate results, cap applied) that the UI renders in ar/fr/en, e.g. "1 240 000 DA sur 1 000 000 = 124 % → palier 120 % → 40 000 DA".
- **Runs**: `IncentiveRun` (planId, period, status `PREVIEW` / `APPROVED` / `EXPORTED`, computedAt, approvedBy, approvedAt) + `IncentiveLine` (runId, userId, ruleId, metric values, target, amount, explanation). Preview can be recomputed any time (it replaces the preview lines; previews are not business history). **Approve** freezes the run (no update, no delete) and is audited. Only one APPROVED run per plan and period.
- After approval, `assertSellerChangeAllowed` (phase 14) refuses to change `Sale.sellerId` / `Payment.collectedBy` on documents of that period (`PERIOD_APPROVED`).
- **Live progress**: `GET /me/objectives` returns, per target, achieved, %, next tier and what is left ("il vous reste 240 000 DA pour le palier 100 %"). Computed on demand with SQL over indexed columns; add indexes `(tenantId, sellerId, validatedAt)` on sales and `(tenantId, collectedBy, receivedAt)` on payments.

### API
- CRUD targets (bulk upsert for a period), plans and rules (validated by the zod union), `POST /incentive-runs` (preview), `POST /incentive-runs/:id/approve`, `GET /incentive-runs/:id` with lines, Excel export (one row per user: rules, amounts, total) for payroll.

### Web
- Plan builder: pick a rule type → a form for its params, live example with fake numbers.
- Targets grid; run screen with per-user detail and explanation; approve button (OWNER, or new permission `INCENTIVE_APPROVE`).
- Seller "Mes objectifs" card on the dashboard (progress bars), team view for supervisors.
- All strings in ar / fr / en.

### Tests
- Unit: each rule type, both tier modes, gates pass/fail, cap, zero target, scope filters, decimal precision (no float), explanation content.
- Integration: metrics from a seeded month (sales, factures from BLs counted once, avoirs, payments, bounces); team target over a 3-level tree; preview → approve freezes; recompute after approve refused; sellerId change refused after approval; avoir after approval lowers next month; plan versioning; scoping (a seller sees only his own objectives); feature off; tenant isolation.

### Not in this phase
Payroll, CNAS, payslips, automatic payment of bonuses (parked).

### Definition of done
AGENTS.md §10. Summary ends with What / How to test manually / Decisions / Next phase (19 Mobile vendeur).
