Read AGENTS.md, docs/ui.md and docs/domain.md (Reports) before doing anything. Read `apps/api/src/reports` (dashboard.service.ts, reports-sql.ts) and the phase 24 scope code. Load the `dataviz` / UI skills before building the screen.

## Task: Phase 26 — Vue d'ensemble: every dépôt on one screen

Branch: `phase-26-overview-dashboard`. Phases 1–25 are merged. Feature flag: `MULTI_UNIT` (without it, the existing dashboard gains only the net-profit card from phase 25 data).

The need: the owner opens one screen on his phone and sees how every dépôt is doing, then taps one to dig in. A manager given `VIEW_STATS` on another dépôt sees it here too.

### What the screen shows
- Period picker: Aujourd'hui, Cette semaine, Ce mois, Mois dernier, Personnalisé (Algiers days).
- A **total row** first (all dépôts the user can see), then **one card per dépôt** in `statsWarehouseIds`:
  - Chiffre d'affaires (net of returns and avoirs), number of sales.
  - Encaissements (versements in) and décaissements (supplier payments + expenses out), net cash.
  - Marge brute (only with `VIEW_COST_AND_MARGIN`), charges of the period (rent prorata + expenses, phase 25), **résultat net** = marge − charges.
  - Créances clients of that dépôt (from phase 24 per-dépôt ledger data) and the share over 90 days.
  - Valeur du stock (with `VIEW_COST_AND_MARGIN`), number of products under the alert threshold.
  - Top seller of the period and his CA.
  - A small sparkline of daily CA over the period, and the change vs the previous equal period (▲ / ▼ %).
- Tapping a card opens the existing dashboard and lists filtered on that dépôt (the header switcher from phase 24 is set).
- A "Comparer" tab: one table, dépôts as rows, the measures above as columns, sortable; Excel export behind `EXPORT_DATA`.

### API
- `GET /reports/overview?from=&to=` → `{ total, warehouses: [...] }`, every amount a decimal string. One SQL pass per measure grouped by `warehouseId` (no N+1 per dépôt), within the scope lists. Target: under 300 ms for 10 dépôts and 200 000 sales on the VPS (add the indexes the plan shows, each starting with `tenantId`).
- Figures must equal what the existing reports return for the same dépôt and period: reuse `reports-sql.ts` helpers, do not write a second definition of CA or marge.
- A dépôt outside `statsWarehouseIds` never appears, not even its name.

### Web
- Every screen follows [`docs/ui.md`](../ui.md): phone first (360 px, `ar` RTL), card lists below `md`, `ResponsiveDialog`, sticky main action. Run the audit skill on it at the end.
- Route `/vue-ensemble`, first item of the menu for users with more than one visible dépôt; others land on the usual dashboard.
- Cards stack on phone, 2 columns on tablet, 3–4 on desktop. Amounts `1 234 567,89 DA`, negative net in red with a minus sign (not only colour).

### Tests
- Playwright mobile (`e2e/web/mobile.spec.ts`): the screen at 360 and 393 px in `ar` and `fr`, no horizontal overflow; screenshots in `e2e/artifacts/mobile/`.
- Unit: period comparison maths, net result.
- Integration: overview totals = sum of the dépôt cards = the existing dashboard figures with no filter; a dépôt's card = the dashboard filtered on it; VIEW_STATS user sees B's card but no B document; a user with one dépôt sees one card; margin and stock value hidden without `VIEW_COST_AND_MARGIN`; tenant isolation.

### Not in this phase
Budgets / objectives per dépôt, forecasting, the Flutter owner app (parked).

### Definition of done
AGENTS.md §10. Summary ends with What / How to test manually / Decisions / Next phase (27 Notifications WhatsApp).
