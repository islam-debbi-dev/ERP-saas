Read AGENTS.md and docs/domain.md (Prices, Sales force & distribution) before doing anything. Read `apps/api/src/sales/sale-lines.ts`.

## Task: Phase 20 — Mode distributeur: promotions & UG, emballages consignés, sell-out par marque

Branch: `phase-20-distribution-mode`. Phases 14–16 are merged. Feature flags: `PROMOTIONS`, `PACKAGING` (sell-out report needs only `SALES_FORCE`).

### Domain rules to respect
- **Promotions** (`Promotion`: name, validFrom, validTo, active, priority, client scope: all / price level / sector / list of clients):
  - Types: `FREE_UNITS` (buy N of X → M free of X or of Y, "10+1"; repeatable or not), `PERCENT_DISCOUNT` (on products, brand or category, optional min quantity).
  - The **API applies** promotions when the sale (or order, phase 16) is priced; the web shows a preview. At most one promotion per line, highest priority wins, ties → the best for the client; write the choice under Decisions.
  - Free units are separate lines: price 0, `isFree = true`, `promotionId`, frozen snapshot of the promotion name. They leave stock normally; their cost lowers the margin (reports show "valeur des gratuités").
  - The seller cannot change free quantities or a promo discount without the new permission `PROMO_OVERRIDE` (audited).
  - Returns (avoir) of a sale with free units: return the free units in proportion, rule written in `docs/domain.md` and unit tested.
- **Emballages consignés** (casiers, palettes, bouteilles, bonbonnes):
  - `PackagingType` master data (name, optional deposit value for display).
  - `ClientPackagingEntry` append-only (tenantId, clientId, packagingTypeId, signed qty: + given to the client, − returned; type `DELIVERY` / `RETURN` / `OPENING` / `ADJUST` / `REVERSAL`, refType, refId) + cached `ClientPackagingBalance` updated in the same transaction. Same ledger rules as money (AGENTS rule 1).
  - Products can declare their packaging (1 casier per 24 bouteilles). A sale posts packaging given automatically; the seller enters packaging returned on the same screen. Cancel a sale → REVERSAL.
  - This phase tracks **counts only**. Money deposits (consigne en DA on the client account) are parked unless the pilot needs it.
  - Relevé emballages per client (screen + PDF), opening balances via Excel import (new import type).
- **Sell-out report par marque**: by brand × product × sector × seller × client type × period, quantities and HT, with returns and free units separated. Excel export with stable column names so a brand can receive it every month.

### API
- CRUD promotions (zod-validated params), `POST /pricing/preview` returns lines with applied promotions; CRUD packaging types; `GET /clients/:id/packaging`, `POST /packaging-movements` (manual return or adjustment, idempotent); `GET /reports/sell-out`.

### Web
- Every screen follows [`docs/ui.md`](../ui.md): phone first (360 px, `ar` RTL), card lists below `md`, `ResponsiveDialog`, sticky main action. Load the UI skills before building screens and run the audit skill on them at the end.
- Promotions page with active / upcoming / ended; sale and order screens show free lines and the applied promotion.
- Packaging returned field on the sale screen; client packaging balance card.
- Sell-out report with filters and export.
- All strings in ar / fr / en; printed BL shows free lines ("UG") and packaging given/returned.

### Tests
- Playwright mobile (`e2e/web/mobile.spec.ts`): each new screen at 360 and 393 px in `ar` and `fr`, no horizontal overflow, main action visible; screenshots in `e2e/artifacts/mobile/`.
- Unit: promotion matching and priority, repeatable FREE_UNITS (25 bought with 10+1 → 2 free), percent discount totals in Decimal, proportional return of free units.
- Integration: sale with promotion posts the right stock and ledger and is idempotent; promotion edited after a sale does not change the sale; packaging ledger on sale, return, cancel; balance reconcile; concurrent sales to the same client keep the packaging balance right; PROMO_OVERRIDE; feature flags off; tenant isolation.

### Not in this phase
Money consigne, supplier-funded promotion claims (refacturation à la marque), lots/DLC (parked).

### Definition of done
AGENTS.md §10. Summary ends with What / How to test manually / Decisions / Next phase (22 Import or back to the backlog).
