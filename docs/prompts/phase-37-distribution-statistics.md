Read AGENTS.md, docs/ui.md, docs/domain.md (Sales, Stock, Tournées, Vue d'ensemble) and docs/architecture.md before doing anything. Then read the phase 36 prompt (`docs/prompts/phase-36-vehicle-first-distribution.md`) and its merged code (`VehicleType`, vehicle fields on `Warehouse`, `VehicleAssignment`, `Visit.vehicleId`, `Order.vehicleId` / `deliveryVehicleId`), `apps/api/src/reports/` (`reports-sql.ts`, `dashboard.service.ts`, `overview.service.ts`, `sell-out.service.ts`, `report-xlsx.ts`, `reports.controller.ts`), `apps/api/src/tournees/tournee-reports.service.ts`, `apps/api/src/sales-force/scope.service.ts`, `apps/api/src/common/business-unit-sql.ts`, `packages/shared/src/dashboard.ts`, `overview.ts`, `periods.ts`, `money.ts`, and on the web `apps/web/src/components/dashboard/` (the phase 33 period switcher and `sales-chart.tsx`), `apps/web/src/components/overview/sparkline.tsx`, `apps/web/components.json`. Use the `/graphify` graph first.

## Task: Phase 37 — Statistiques distribution

Branch: `phase-37-distribution-statistics`. **Needs phase 36 merged and its backfill run.** Phases 19, 23, 27, 28, 29 and 32 are not built: do not build any part of them. Production is Vercel + Neon: no VPS, no timers, no background jobs, no materialised views refreshed by a cron.

### Why
The big distributors we want to win (several dépôts / CDD, 10 to 50 trucks, prévente + livraison + cash van) run their day from a statistics screen: per truck, per truck type, per dépôt, per wilaya, per product family, per client type. Competitors show many charts, but often with figures that do not add up (delivery rates above 100 %, "0 t" weights, empty slices labelled "(vide)"). Our edge is **figures a director can trust**: every number has one definition written in `docs/domain.md`, adds up across views, and opens the documents behind it.

### Rules that do not change
- **Statistics write nothing** (except the per-vehicle targets and client segments defined below, which are master data with audit). No money or stock effect.
- **The API computes, the web draws.** Every sum, rate and average is computed in SQL / `decimal.js` on the API and sent as strings; the web never adds or divides money or weights.
- **One definition per figure**, in `packages/shared/src/distribution-stats.ts` (names, units, formulas as doc comments) and a new "Statistiques distribution" section in `docs/domain.md`. The same figure computed in two tabs must be equal (integration test).
- **Scope**: exactly the phase 14 / 24 rules. Owner and `VIEW_ALL_WAREHOUSES` see all; a user with `VIEW_STATS` or `OPERATE` on a dépôt sees that dépôt and its trucks; a supervisor sees his team's trucks; a SELLER / LIVREUR sees only a "Mon véhicule" card for the truck he drives today (no other truck, no ranking with names of others). A truck outside the scope never appears, not even in a total.
- **Phone first** (docs/ui.md): 360 px `ar`, no sideways page scroll, nothing on hover only; every chart has a "Tableau" toggle that shows the same numbers as an accessible table.

### Architecture (one engine, not ten endpoints of copy-pasted SQL)
- **Measure / dimension registry** in `apps/api/src/distribution-stats/registry.ts`: each *measure* (CA TTC, Nb BL, poids, versements, visites…) declares its base fact (sales, returns, payments, visits, orders, loads, sessions), its SQL expression, its unit and its null rule; each *dimension* (vehicle, vehicle type, activity, dépôt, wilaya, segment, brand, category, product, client, day / week / month) declares its join and its label. Endpoints are thin: they pick measures + dimensions + filters and call one `StatsQueryService.run()`. A new chart = a registry entry, not a new query.
- **One fact CTE per base fact**, scope and tenant applied once inside it (never in the outer query), then aggregated. Two measures of different facts are joined on the dimension key after aggregation (never row × row, which double counts).
- **Vehicle attribution in one place**: a SQL helper `vehicleOfSql(fact)` and the TS `vehicleAt(vehicleId, t)` from phase 36; no endpoint resolves a truck on its own.
- **Contract test**: for every measure × every dimension in the registry, Σ of the grouped rows (incl. "Sans véhicule" / "Autres") = the ungrouped total. It runs on the seed and fails when a new entry breaks additivity.
- DTOs: `{ measure, unit, value: string | null, estimated: boolean }` everywhere, so the web never guesses a unit.
- Module boundaries (AGENTS.md §4): the stats module reads other modules' tables only through read-only SQL in its own service (as `reports` does today) and never writes; it imports the scope helpers, not other services' internals.

### Feature and permission
- New `Feature.DISTRIBUTION_STATS` in `packages/shared/src/features.ts`, in the DISTRIBUTION and ENTREPRISE editions (so the super-admin can sell or remove it per company with the existing grants / revokes). Without it the menu entry is hidden and the API answers the usual feature error.
- Read: `REPORTS_VIEW`. Margins and cost values: also `REPORTS_FINANCE` (else `null` in the DTO, as phase 33 does). Targets and segments edit: `SETTINGS_EDIT`.

### Definitions (write them exactly, unit-test the pure parts)
| Figure | Definition |
|---|---|
| CA TTC | Σ `totalTtc` of validated BL and direct factures in the period (by `validatedAt`, Africa/Algiers day), minus Σ validated avoirs (returns) of the period. Factures that group BLs are never counted again. |
| Nb BL | Validated BL + direct factures, not cancelled. |
| Drop size | CA TTC / Nb BL (null when 0 BL). |
| SKU / BL | Average number of distinct products per BL. |
| Poids vendu (t) | Σ line weight / 1000, from the frozen line weight (below). Lines whose product has no weight are counted in "poids inconnu (N lignes)", never as 0 silently. |
| Clients actifs (POS) | Distinct clients with ≥ 1 BL in the period. |
| Versements | Σ valid payments collected in the period (bounced cheques excluded), attributed to a truck as below. |
| Taux de recouvrement | Versements / CA TTC of the period (can exceed 100 % when old debt is paid; say so in the tooltip). |
| Bons de commande | Confirmed orders (count, TTC) by confirmation day; "J-1" = the day before the period's end. |
| Taux de livraison | Σ delivered qty / Σ ordered qty (base units) of the orders confirmed in the period that are delivered or cancelled, capped and computed per line, **never above 100 %**. Orders still open are shown apart ("en attente"). |
| Valeur de chargement | Σ LOAD transfers to the truck in the period, valued at CUMP at validation (`REPORTS_FINANCE`) and in TTC price level 1 for everyone else, with the basis written in the column header. |
| Taux de remplissage | Poids chargé / `capacityKg` per load (null without capacity). |
| Avaries | Σ validated retours (`SaleReturn`) with `disposition = DAMAGED` (qty, value) on the truck's sales. |
| Écart de caisse | Σ `ecart` of the truck's closed `SellerSession` rows (plus their ADJUST rows). |
| Visites planifiées | For each day of the period and each active vehicle route of that weekday: its stops (count). Days before phase 36 count only routes that existed then (`createdAt`); say "planification inconnue" before that. |
| Visites effectuées / avec succès | Distinct (client, day) with a non-corrected visit; succès = outcome `SALE` or `ORDER`. |
| Taux visités / planifiés, succès / planifiés, succès / visités | Ratios of the three counts above, null when the base is 0. |
| Causes de non-achat | `NO_SALE` visits by `reason`. |
| Réalisation vs objectif | Figure of the month / the vehicle's target for that metric (below). |

- **Which truck a figure belongs to**: a sale → `Sale.warehouseId` when it is a VEHICLE; a visit → `Visit.vehicleId`; an order → `Order.vehicleId` (prévente) and `deliveryVehicleId` (livraison); a payment → `Payment.warehouseId` when it is a VEHICLE, else the truck its `collectedBy` drove at `createdAt` (from `VehicleAssignment`), else none. Everything without a truck is grouped as **"Sans véhicule / dépôt"**, never dropped, so totals across trucks equal the global total.
- **Frozen weight** (rule 9): add `SaleLine.weightKg Decimal(14,3)?` = `qtyBase × Product.weightKg` set at validation (null when the product has no weight); the same on `SaleReturnLine` and `StockTransferLine`. Old rows: the statistics fall back to the current product weight and mark the figure "estimé" (one flag in the DTO). No backfill of old lines (it would freeze a guess).

### Master data added (small)
- **Client segments** (names the owner creates to recognise his clients, no behaviour attached; the competitor's "type client / canal": détaillant, supérette, grossiste, café…): tenant table `ClientSegment` (`code`, `name`, archive) and `Client.segmentId?`. Editable from the client form and the Excel import (map a "Type" column; unknown values listed in the preview, never auto-created without confirm). The existing `ClientType` (PARTICULIER / PROFESSIONNEL) stays as is.
- **Per-vehicle monthly targets**: table `VehicleTarget` (`vehicleId`, `periodStart` first day of month, `metric` `CA_TTC | POIDS_KG | NB_BL | CLIENTS_ACTIFS`, `targetValue Decimal(16,3)`), unique `(tenantId, vehicleId, periodStart, metric)`, audit on create / change. It is **not** read by the incentives engine (phase 18 stays per user); write that in the doc comment. Copy last month's targets in one action.

### Schema (one migration, additive only)
`sale_lines.weightKg`, `sale_return_lines.weightKg`, `stock_transfer_lines.weightKg` (all nullable); `client_segments` (+ RLS, partial unique on live code); `clients.segmentId?` + index `(tenantId, segmentId)`; `vehicle_targets` (+ RLS); indexes for the hot queries after checking `EXPLAIN ANALYZE` (likely `sales (tenantId, warehouseId, validatedAt)` WHERE status validated, `stock_transfers (tenantId, toWarehouseId, validatedAt)`). After merge: `pnpm --filter @erp/api db:deploy` on Neon (write it in the PR and the summary).

### API (`apps/api/src/distribution-stats/`, read only)
- One filter schema `distributionStatsQuerySchema` in `packages/shared`: `from`, `to` (max 366 days), `compare` (`none | previous | lastYear`), `groupBy` (`day | week | month`), and multi-select filters `warehouseIds` (dépôts / CDD), `vehicleIds`, `vehicleTypeIds`, `activities`, `vehicleWilayas`, `clientWilayas`, `brandIds`, `categoryIds` (a family includes its sub-families), `productIds`, `segmentIds`, `sectorIds`, `clientIds`. Every endpoint takes all of them; a filter the endpoint cannot apply is refused with `STATS_FILTER_NOT_APPLICABLE`, never silently ignored.
- Endpoints (each one raw SQL query or a few, no N+1, scope applied through `scope.*Sql` + `business-unit-sql.ts`):
  - `GET /stats/distribution/overview`: the KPI tiles (CA, Nb BL, drop size, SKU/BL, poids, clients actifs, versements, recouvrement, BC + BC J-1, taux de livraison, véhicules actifs) with the comparison value and trend for each.
  - `GET /stats/distribution/by-vehicle`: one row per truck (+ "Sans véhicule"): code, type, wilaya, dépôt, driver(s) of the period (from `VehicleAssignment`), every figure of the table above, target and % when set.
  - `GET /stats/distribution/by-dimension?dimension=vehicleType|activity|depot|vehicleWilaya|clientWilaya|segment|sector|brand|category|subCategory|product|client`: the same measures grouped, top 50 + "Autres".
  - `GET /stats/distribution/timeline?measure=`: series per `groupBy` bucket, optional split by up to 8 trucks or one dimension.
  - `GET /stats/distribution/visits`: planned / done / success, ratios and non-sale reasons, by truck and in total.
  - `GET /stats/distribution/vehicle-day?vehicleId=&date=`: the "récap journée véhicule": chargement, ventes, retours / avaries, déchargement, versements, cash attendu / remis / écart, visites, poids; each line links to its documents.
  - `GET /stats/distribution/dispersion`: truck × day matrix of CA (and BL count) for the period, to spot irregular trucks.
  - `GET /stats/distribution/export.xlsx?view=`: the same rows as the matching view, one sheet, French headers, numbers as numbers (reuse `report-xlsx.ts`).
- Performance budget on Neon from Vercel: each endpoint under 600 ms for 1 year, 40 trucks, 200 000 BL (bulk up the seed in a test DB, write the `EXPLAIN ANALYZE` numbers in the summary). Queries must be written so a future daily summary table can replace their base CTE without changing the DTO (note it under Parked ideas).
- `Cache-Control: private, max-age=60`. No idempotency key (read only).
- Drill-down: every row and tile carries the query string of the list behind it (`/ventes?warehouseId=&from=&to=`, `/tournees/rapports?vehicleId=`, `/commandes?deliveryVehicleId=`…), reusing the existing list filters (add `vehicleId` / `segmentId` filters to those lists additively where missing).
- Targets: `GET/PUT /vehicle-targets?period=` (bulk upsert of a month, `SETTINGS_EDIT`, audit), `POST /vehicle-targets/copy-previous`. Segments: `GET/POST/PATCH /client-segments`, archive.

### Web: `/statistiques`
- Entry "Statistiques" in `navigation.ts` (with `DISTRIBUTION_STATS`), and a link from the dashboard and the vue d'ensemble.
- **Charts**: add the shadcn/ui `chart` component (`npx shadcn@latest add chart`, which brings `recharts`): this is the one new runtime dependency of the phase, name it in the commit with the reason ("statistics need grouped bars, areas, donuts and dual axes; hand-made divs do not scale"). Build the charts from the shadcn chart gallery patterns (https://ui.shadcn.com/charts: bar *multiple* / *stacked* / *horizontal* / *label* / *interactive*, area, line, pie *donut with text*, radial for target %) with `ChartContainer`, `ChartTooltip`, `ChartLegend`, adapted to our data, not copied with their demo data. Load it **only** on `/statistiques` (dynamic import, `ssr: false`), so the dashboard bundle does not grow. Keep the phase 33 hand-made chart on the dashboard. Use the shadcn chart CSS variables for colours (light + dark), never colour as the only clue (labels, patterns or a legend with values). In Arabic the time axis runs right-to-left (`reversed` on the X axis) and numbers stay LTR.
- **Professional, not flashy**: no decorative animation (no tile reveal, no counters spinning, no parallax). Only a short fade when data changes, off under `prefers-reduced-motion`. Sober colours, aligned numbers (`tabular-nums`), clear titles and units.
- **Do not use React Bits Pro** (or any paid component kit) in the product: it is a paid per-developer licence, mostly decorative motion, and adds weight to screens that must stay fast on cheap Android phones. Motion here = the existing `tw-animate-css` and short transitions, off under `prefers-reduced-motion`.
- Layout: a sticky filter bar (period chips Aujourd'hui / Hier / 7 j / Ce mois / Mois dernier / Personnalisé, "Comparer", and a "Filtres (N)" button opening a sheet with the multi-selects); the filters live in the URL so a view can be shared or bookmarked. Views (a `Select` on phone, tabs on `md+`):
  1. **Vue globale**: KPI tiles (value, trend vs comparison, sparkline), CA by dépôt / CDD, top trucks.
  2. **Véhicules**: the by-vehicle table (card list on phone, sortable table on `md+`), grouped bars CA / versements with drop size as a line, poids by truck, Nb BL by truck.
  3. **Types & zones**: by vehicle type, activity, vehicle wilaya, client wilaya, dépôt.
  4. **Produits**: donuts / bars by family, sub-family, brand; top products with poids.
  5. **Clients**: by segment, sector; clients actifs vs inactifs ("clients perdus": bought in the comparison period, not in this one, with a link to the list).
  6. **Visites**: planned / done / success funnel per truck, non-sale reasons donut.
  7. **Commandes & livraison**: BC, BC J-1, taux de livraison, open orders per delivery truck.
  8. **Dispersion**: truck × day heat table (numbers in the cells, colour as a second clue).
  9. **Objectifs**: réalisation vs objectif per truck and metric, with the target editor for `SETTINGS_EDIT`.
  10. **Journée véhicule**: pick a truck and a day → the récap (printable layout, export xlsx).
- Every chart: title, the definition in an info popover (from the shared definitions), "Tableau" toggle, export xlsx, tap a bar / slice → the drill-down link. Empty and "poids estimé / inconnu" states are explicit.
- "Mon véhicule" card for SELLER / LIVREUR on the dashboard: today's CA, BL, versements, visits done / planned and the month vs target of the truck he drives.
- Strings in `ar`, `fr`, `en` (parity test). Amounts `1 234 567,89 DA`, weights `12,350 t`, rates `87,5 %`.

### Tests
- Unit (shared): every definition helper (drop size with 0 BL, delivery rate capped per line, ratios with zero bases, weight from frozen vs current, comparison periods across month ends and leap years, `groupBy` buckets in Africa/Algiers).
- Integration (API, real DB), on a fixed seed with 3 dépôts, 6 trucks of 3 types, 2 wilayas, sales, avoirs, orders, visits, loads, damaged returns and closings:
  - each figure equals a hand-computed value; Σ by-vehicle (incl. "Sans véhicule") = overview total for CA, BL, poids, versements; by-dimension totals equal the overview too;
  - a driver change in the middle of the period: the truck keeps its full figures, the period shows both drivers;
  - the taux de livraison never exceeds 100 % (over-delivery fixture);
  - scope: dépôt VIEW_STATS user sees only his dépôt's trucks and totals; supervisor his team; seller only "Mon véhicule"; `REPORTS_FINANCE` off → cost values null;
  - tenant isolation on every endpoint (B's ids in filters give nothing, never B's rows);
  - feature off → refused; filter not applicable → `STATS_FILTER_NOT_APPLICABLE`;
  - targets upsert / copy are audited, unique per month and metric; segments CRUD and import mapping.
- Playwright mobile: `/statistiques` each view at 360 and 393 px in `ar` and `fr`, filter sheet, "Tableau" toggle, no horizontal overflow, the filter bar reachable without scrolling. Screenshots in `e2e/artifacts/mobile/`.
- Playwright (`web.spec.ts`): change the period → tiles update; tap a truck bar → lands on its filtered sales list with the same total.
- Lighthouse on `/statistiques` (mobile): performance ≥ 80 after the chart code split; write the scores in the summary.

### Not in this phase
Scheduled e-mail / WhatsApp reports (needs phase 27 and a VPS), daily summary tables / materialised views (later, when a tenant passes ~1 M lines), a drag-and-drop custom report builder, maps of sales by zone (heat map), AI insights, fuel and kilometre costs per truck, sell-out per retailer outlet. List them under "Parked ideas".

### Definition of done
AGENTS.md §10. Summary ends with What / How to test manually (including `db:deploy` on Neon) / Decisions / Next phase (38).
