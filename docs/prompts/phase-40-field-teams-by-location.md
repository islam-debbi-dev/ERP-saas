Read AGENTS.md, docs/ui.md, docs/domain.md (Tournées, Sales force, Objectifs & primes, Statistiques distribution) and docs/architecture.md before doing anything. Use the `/graphify` graph first to find the files a step touches, then open only those. Then read the phase 14, 16, 18, 36, 37 and 39 prompts in `docs/prompts/` and their merged code: `packages/shared/src/{enums,permissions,wilayas,incentives,distribution-stats,periods}.ts`, `apps/api/src/sales-force/scope.service.ts`, `apps/api/src/tournees/*` (`tournee-scope.ts` `SELLERS` / `PLANNERS`, `routes.service.ts`, `orders.service.ts`, `visits.service.ts`), `apps/api/src/incentives/`, `apps/api/src/distribution-stats/`, the web `/statistiques` pages and the Flutter app `apps/mobile/lib/core/router/` (`RoleScreens`) and `features/{today,team,objectives,orders,delivery}`.

## Task: Phase 40 — Équipes terrain par zone (wilaya / daïra / commune), pré-vente, objectifs SVP et statistiques refaites

Branch: one branch per sub-phase, `phase-40a-locations`, `phase-40b-zones-roles`, … (see "Order of work"). Each sub-phase is one PR that builds, passes `pnpm lint && pnpm typecheck && pnpm test`, and can be merged alone. Phases 23, 27, 28, 29, 32 and 38 are not built: do not build any part of them. Production is Vercel + Neon: no VPS, no timers, no cron, no background jobs. **A sub-phase with a migration: run `pnpm --filter @erp/api db:deploy` on Neon BEFORE merging its PR** (write it at the top of the PR and of the summary).

### Reference
The real SVP file is summarised in [`docs/reference/svp-kpis.md`](../reference/svp-kpis.md) (sheets, figures, a few fixture numbers). Read it before 40e and 40f; the SVP coverage table of the PR is built from it. Do not ask for the Excel file and never commit it (it has real names).

### Why
Big distributors (the owner received a real monthly "SVP" Excel file from distribution company leaders: a beverage distributor, canals Détail mixte 01–05 / Horeca / Self-service / Demi-gros / Gros, one van per route) manage their field force **by place**: a superviseur is responsible for one or two cities (communes), a **chef de zone** (head of area) for many communes or wilayas. Every morning they look at, per member and per product: objective vs réalisation, % , average per day, what is left to do per day, the end-of-month forecast (atterrissage), visits planned / done / productive, active clients, number of BL. Today our clients have a free-text `wilaya` / `commune`, routes have only weekdays, there is no head-of-area role, no prévendeur role, and the statistics cards are too small to read on a phone. This phase fixes all that.

### Rules that do not change
- AGENTS.md §3 (ledger, one transaction per business operation, idempotency on money/stock POSTs, audit, frozen history, tenant isolation, money as `decimal.js`), §4 (zod in `packages/shared`, `AppException`, i18n `ar`/`fr`/`en`, phone first), §5 (integration tests on a real DB).
- **The API computes, the web and the app draw.** Every sum, %, average, forecast is computed on the API and sent as strings.
- **A sale counts for the team that made it** (seller → his supervisor → his chef de zone, at the time of the sale). Location (wilaya / daïra / commune of the client) is a **filter and a dimension only**, never what decides whose figure it is. Owner's decision, 2026-11-27.
- **One definition per figure**, in `packages/shared/src/distribution-stats.ts` and `docs/domain.md`. The same figure on two screens is equal (integration test). Reuse the phase 37 registry (measures × dimensions, one fact CTE per base fact, additivity contract test); do not write a second engine.
- **Roles are a closed list.** When you add a role, grep every place that lists roles (`Role`, `ROLES`, `SELLING_ROLES`, `DRIVING_ROLES`, `OFFICE_ROLES`, `ROLE_PERMISSIONS`, `tournee-scope.ts` `SELLERS` / `PLANNERS`, `scope.service.ts`, the mobile seat limit `maxMobileSellers`, the web users form, the Flutter `fieldRoles` and `RoleScreens`, the seed, the i18n role labels) and decide each one explicitly; write the table of decisions in the PR.

### Owner's decisions (2026-11-27, do not reopen)
1. Location = **wilaya + daïra + commune** chosen from an official list (never typed), and the quartier / secteur ("Sonitex", "1000 Logts") stays a free name (existing `Sector`).
2. The communes of the new wilayas 59–69 are prepared by us and **reviewed by the owner** before the 40a PR merges (list them in a review file).
3. A **new role** for the head of area: `AREA_MANAGER` (fr "Chef de zone", ar "رئيس المنطقة", en "Area manager").
4. A sale counts for the team that sold it; location is a filter.
5. Objectives per **product and per family**, in **caisses and in DA**, both.
6. The company sends its objectives; the **superviseur** enters them for his team (like the SVP file: per member, per product / format, per family), and the **chef de zone** can enter them too, for his whole area.
7. The chef de zone's scope is **his area** (zone).
8. A route stays a weekday template; the system shows a **dated "route of the day"**, and the superviseur can change one day (add / remove a client) without touching the template.
9. Route history: for a past route, each client shows visited + sold, visited + commande, visited no sale (+ reason), not visited.
10. **A seller sees only the clients of the zone his superviseur sends him to** (e.g. Boussaâda). When the superviseur moves him to another commune, he sees that commune's clients and no longer the old ones.
11. New role **pré-vendeur** (`PREVENDEUR`): takes **commandes only** (no truck stock, no BL, no versement). Each pré-vendeur has a **linked livreur**; the superviseur can change it; one livreur can serve several pré-vendeurs. A confirmed commande goes to the linked livreur automatically, to deliver **the next working day**.
12. No "aide vendeur" (he is only the driver).
13. Superviseur and chef de zone see their homes **on the web and in the Debvora app**.
14. Livreur home: today's commandes grouped by pré-vendeur, in route order.
15. Chef de zone home: ranking of superviseurs and communes vs objective + a map coloured by %.
16. A **work calendar** per company (Friday off by default, plus holidays) drives jours ouvrables / restants and the atterrissage.
17. Each route has **one canal** = the existing phase 37 `ClientSegment` (Détail, Horeca, Self-service, Demi-gros, Gros…).
18. **Statistics redesigned**: today the cards are too small; each KPI gets the space it deserves (big number, objective, progress, forecast, tap → its own detail page). Screens are enough: no SVP-shaped Excel export.
19. Parked (owner wants them remembered for a later phase): monthly plan d'action, superviseur weekly planning, veille concurrentielle.

---

### 40a — Locations: wilaya / daïra / commune
- **Data** in `packages/shared/src/communes.ts` (+ a JSON file if large, imported statically): every commune with its official code, its daïra, its wilaya code (1–69), names `fr` and `ar`. Start from a public dataset of the 1 541 communes (check its licence and write the source + licence in the file header; if no dataset has a usable licence, stop and tell the owner). Re-home the communes of wilayas 59–69 from their mother wilaya following the texts already cited in `wilayas.ts` (law 26-06, decree 26-206); write every moved commune in `docs/review/communes-59-69.md` (commune, old wilaya, new wilaya, source) for the owner to check. Pure helpers: `communesOf(wilayaCode)`, `dairasOf(wilayaCode)`, `communeByCode()`, `findCommune(text, wilayaCode?)` (accent / case / Arabic-Latin tolerant, returns candidates, never guesses silently). Unit tests: counts per wilaya, every daïra in one wilaya, codes unique, 59–69 non-empty.
- **Schema (expand only)**: `clients.wilayaCode SmallInt?` (CHECK 1–69), `clients.communeCode Int?` + index `(tenantId, communeCode)`; `sectors.wilayaCode`, `sectors.communeCodes Int[]`. The old text columns `clients.wilaya` / `commune` and `sectors.wilaya` / `communes` stay (contract in a later release; add it to the contract list in `apps/api/prisma/contract/`). Daïra is derived from the commune, never stored.
- **Backfill** `pnpm --filter @erp/api db:backfill-communes` (idempotent, run twice → second run 0 changes): match the old text with `findCommune`; exact single match → set codes; else leave null and print a CSV of unmatched clients. Never overwrite a code already set.
- **Forms**: client form (web + app), sector form and the Excel client import: three dependent selects Wilaya → Daïra → Commune (searchable, `ar` and `fr` names), quartier stays text. Import: unknown commune → listed in the preview, never auto-created.
- **Stats dimensions** added to the phase 37 registry: `clientWilaya` (now from the code), `clientDaira`, `clientCommune`.

### 40b — Zones, roles AREA_MANAGER and PREVENDEUR, seller zone assignment, scope
- **Zones**: table `field_zones` (`id`, `tenantId`, `name`, `kind` `AREA | CITY`, `parentZoneId?` (a CITY zone sits inside an AREA), `wilayaCodes SmallInt[]`, `communeCodes Int[]`, `responsibleUserId?`, `deletedAt`, RLS). A commune given to a whole wilaya counts as "all communes of that wilaya". An AREA's communes ⊇ its CITY zones' communes (validated). Two live zones of the same kind may not share a commune (validated, error `ZONE_COMMUNE_TAKEN` with the other zone's name).
- **Roles**: `AREA_MANAGER` and `PREVENDEUR` in `Role` (migration adds the enum values). Hierarchy through the existing `User.managerId`: SELLER / PREVENDEUR / LIVREUR → SUPERVISOR → AREA_MANAGER → OWNER/MANAGER (validated: no cycle, an AREA_MANAGER reports to OWNER/MANAGER or nobody). Default rights: AREA_MANAGER = SUPERVISOR's rights + targets edit + zone assignment for his area; PREVENDEUR = `VIEW_ALL` reading scoped to his clients, `CLIENTS_CREATE`, `CLIENTS_EDIT`, commandes + visits; **not** `SALES_CREATE`, **not** `PAYMENTS_CREATE`, no truck. Add PREVENDEUR to `SELLERS` for orders and visits only (check every endpoint guarded by `SELLERS`; a pré-vendeur calling a van-sale or versement path gets `FORBIDDEN`). PREVENDEUR counts in the mobile seat limit like SELLER; AREA_MANAGER does not (like SUPERVISOR; check what phase 39 does).
- **Seller zone assignment** (decision 10): table `seller_zone_assignments` (`userId`, `communeCodes Int[]` or `zoneId?`, `validFrom`, `validTo?`, `assignedBy`, audit), append-only like `VehicleAssignment`: a move closes the current row (`validTo = now`) and opens a new one in one transaction. Only the user's superviseur, his chef de zone or OWNER/MANAGER can assign, and only communes inside their own zone.
- **Scope**: new `SellerScope.BY_ZONE` (tenant setting, Settings → Force de vente). With it, a SELLER / PREVENDEUR sees the clients whose `communeCode` is in his **current** assignment (plus clients assigned to him by `assignedSellerId`, if the owner turns that on). His own past documents stay visible to him (sales, visits, commandes he made), even for clients now outside his zone. Clients without a commune code are not shown to sellers under `BY_ZONE`; the superviseur gets a "Clients sans commune (N)" list to fix them. SUPERVISOR scope = his team (as today); AREA_MANAGER = every team under him **and** location filters limited to his AREA zone. Put all of it in `scope.service.ts`, never in a controller.
- Fix on the way (parked gap from phase 39): `GET /orders/deliverers` and `PATCH /orders/:id/livreur` must be limited to the caller's team / area.

### 40c — Dated routes ("route du jour") and route history
- Add `routes.segmentId?` (the canal, decision 17) and show it on routes.
- **No row is created by reading** (no cron, no materialisation on GET). The plan of a day = the route's template stops for that weekday + the day's overrides. Table `route_day_overrides` (`routeId`, `date`, `clientId`, `action ADD | REMOVE`, `position?`, `createdBy`, audit; unique `(tenantId, routeId, date, clientId)`). Only the route's superviseur / chef de zone / OWNER/MANAGER edit a day; a past day is read-only.
- A pure function `planOfDay(template, overrides, date)` in `packages/shared` (unit tests: ADD then REMOVE, REMOVE of a client not in the template is refused, position order). Phase 37 "visites planifiées" must use it, so the stats and the seller's screen give the same count (integration test).
- Endpoints: `GET /me/routes?from=&to=` (the seller's or pré-vendeur's dated routes, with planned / visited / productive counts per day), `GET /me/routes/:routeId/days/:date` (stops in order; for each client: status `NOT_VISITED | VISITED_SALE | VISITED_ORDER | VISITED_NO_SALE` + reason, and a flag for clients visited off-plan), `GET/PUT /routes/:id/days/:date/overrides` for planners. Cursor pagination on history (§4).
- A client outside the seller's current zone is not offered in the day plan; an override that adds one is refused with `CLIENT_OUT_OF_ZONE`.

### 40d — Pré-vente → livreur automatique
- `users.linkedLivreurId Uuid?` (a LIVREUR of the same tenant; one livreur may be linked to many pré-vendeurs). Changes audited; the superviseur of the pré-vendeur (or his chef de zone, OWNER/MANAGER) can change it.
- When a PREVENDEUR confirms a commande (`POST /orders/:id/confirm`), in the same transaction: `livreurId = linkedLivreurId`, `requestedDate = nextWorkingDay(today)` from the work calendar (40e; until 40e is merged, tomorrow skipping Friday). The livreur is **frozen on the order** (changing the link later does not move confirmed orders). No linked livreur → the order stays confirmed "à assigner" and appears on the superviseur's home with a counter; never lost, never blocked.
- The superviseur can still reassign one order (existing `PATCH /orders/:id/livreur`, now team-scoped).
- Livreur's day: `GET /me/deliveries?date=` (default today): orders with `requestedDate = date`, grouped by pré-vendeur, ordered by the pré-vendeur's route of the day before (the stop position), then the rest. Stock and delivery rules of phase 36 do not change (the delivery truck is loaded by chargement).
- Tests: confirm → livreur + date set once (idempotent replay changes nothing), Thursday → Saturday, a holiday skipped, no linked livreur, livreur link change does not touch confirmed orders, tenant isolation, a pré-vendeur cannot create a BL or a versement.

### 40e — Objectifs SVP (caisses and DA), work calendar, forecast
- **Caisses**: `products.statsUnitId Uuid?` = the product's "caisse" (one of its `ProductUnit`). Frozen at validation (rule 9): `sale_lines.caisses Decimal(14,3)?` = `qtyBase / factor of statsUnit` (null when the product has none), same on `sale_return_lines`. Old rows: the stats fall back to the current unit and mark the figure `estimated` (same mechanism as the phase 37 frozen weight). No backfill.
- **Work calendar**: `tenants.weeklyOffDays SmallInt[]` default `{5}` (Friday, ISO weekday in Africa/Algiers), table `tenant_holidays` (`date`, `name`; unique per tenant and date). Settings screen. Pure helpers in `packages/shared/src/work-calendar.ts`: `workingDaysOfMonth`, `workingDaysElapsed(today)`, `workingDaysLeft(today)`, `nextWorkingDay`. Unit tests across month ends, holidays on off days, today being an off day.
- **Targets**: extend the phase 18 `SalesTarget` (do not add a second target table): new metrics `CAISSES` (and the existing `CA_HT`, plus `CA_TTC` if the SVP figures are TTC: check `docs/domain.md` and say which one you used in Decisions), scopes per product, per family (`categoryId`, a family includes its sub-families), per brand, or total; per user (`userId`) or per team (`teamManagerId`) — a chef de zone's area target is the team target of the AREA_MANAGER. The incentives engine keeps its current metrics: `CAISSES` is not added to bonus rules in this phase (write it in the doc comment; Parked).
- **Entry screen like the SVP sheet**: `/objectifs` (web, and a simplified version in the app for superviseur / chef de zone): pick the month; rows = members of my team (or superviseurs of my area), columns = families and their products (collapsible), each cell caisses and DA; a "Objectif reçu de la société" line on top for the team / area with **"reste à répartir"** per column (team target − Σ members), never blocking. "Copier le mois dernier". Bulk `PUT /targets?period=` with audit. Rights: new permission `TARGETS_EDIT` (SUPERVISOR for his team, AREA_MANAGER for his area, OWNER/MANAGER for all); a supervisor cannot edit another team's targets (`FORBIDDEN`).
- **Figures (write these definitions exactly in `distribution-stats.ts` and `docs/domain.md`)**:

| Figure | Definition |
|---|---|
| Réalisation (caisses / DA) | Phase 37 CA (and Σ frozen caisses) of validated BL + direct factures minus avoirs, in the period, for the scope. |
| % réalisation | Réalisation / objectif; null without objectif. |
| Jours ouvrables / écoulés / restants | From the work calendar for the month and today (Africa/Algiers). |
| Jours travaillés (per member) | Working days with ≥ 1 visit or validated BL by the member. |
| Moyenne / jour | Réalisation / jours travaillés (null when 0). |
| Reste à faire / jour | max(0, objectif − réalisation) / jours restants (null when 0 days left). |
| Atterrissage (forecast) | Réalisation + (réalisation / jours ouvrables écoulés) × jours restants; `estimated: true`; shown as "prévision". |
| Visites programmées / réalisées / productives | Phase 37 planned (now from `planOfDay`) / done / success. |
| Taux de succès (SVP) | Nb BL / visites réalisées (the SVP sheet "Performances": factures ÷ visites). Show productives / réalisées next to it as "visites productives %". |
| Couverture (SVP) | Visites réalisées / visites programmées (distinct client × day). |
| Jours perdus | Working days of the month already passed with no visit and no BL for the member. |
| Nb BL (factures) | Phase 37 Nb BL. |
| Drop size | Caisses / Nb BL, and CA / Nb BL ("facture en valeur"), in total **and per product per canal** (SVP "DROP SIZE par produit par canal": caisses of the product / Nb BL of the canal). |
| Moyenne par format | Caisses of a product / jours travaillés (SVP "Moyenne ventes par format"). |
| Univers clients | Live clients of the scope's zone (by commune), or of the member's routes for a member. |
| Clients actifs / taux d'activation | Distinct clients with ≥ 1 BL in the period / univers. |
| Poids par canal | Share of caisses (and CA) per `ClientSegment` of the route. |
| Poids par produit | Share of each product / family in the total caisses of the scope (SVP "Poids par produit en caisse"). |
| Comparaisons | Same days of last month (MTD vs MTD), monthly average of last year's Q4, and the 12-month trend. |

- **SVP coverage check**: write in the PR a table "SVP sheet → figure → screen" for every figure of the sheets Consolidé wilaya, Ventes, Performances, Actualisations, Atte, Suivi Gros & D-G and the per-route sheets (D-M, H, S-S, DG, Gros); a figure not built must be in Parked with the reason.
- New dimensions in the registry: `member` (seller / pré-vendeur), `supervisor`, `areaManager`, `zone`, `route`, `canal` (route segment). The phase 37 additivity contract test must pass for every new measure × dimension (Σ groups incl. "Sans …" = total).

### 40f — Statistics redesigned + web homes per role
Load the UI / design skills first, including the owner's **`design-upgrade`** skill (users not good with tech: simple, big buttons, icon + word, big readable numbers). The phase 37 rules on charts stay (shadcn charts, little motion, `prefers-reduced-motion`, "Tableau" toggle, drill-down links, no paid kit).
- **KPI card, one component** (`KpiCard`): label with icon + word, the number big (≥ 32 px on phone, `tabular-nums`, unit next to it), objectif, a progress bar with the %, atterrissage ("prévision : 92 %"), trend vs comparison, coloured by state with a word too (en avance / dans les temps / en retard — never colour alone). On phone **one card per row, full width**; 2 columns `md`, 3–4 `lg`. Tap → **its own page** `/statistiques/kpi/[measure]` with: the figure big, a chart over the month (day by day, objective line), and breakdowns by member, product / family, commune, canal (each a tab, table + chart, sortable, drill-down).
- Rework the existing `/statistiques` views to use `KpiCard` and full-width charts; nothing smaller than 14 px; tables become card lists on phone.
- **Superviseur home** (web dashboard for SUPERVISOR): team strip of KPI cards (CA, caisses, % objectif, atterrissage, visites, clients actifs, BL), then **one card per member**: name, % objectif with bar, % per product (top products as bars, "voir tout" opens the member page), visits done / planned, clients actifs, Nb BL, jours travaillés; sorted by % (lowest first, so he sees who needs help). Counter "commandes à assigner" and "clients sans commune".
- **Chef de zone home**: same KPI strip for the area, ranking of superviseurs and of communes vs objective, and a map of communes / wilayas coloured by % (reuse the phase 35 leaflet map; commune centroids from the dataset if it has them, else wilaya level only, say which).
- **Member page** `/equipe/[userId]`: everything of the member card, per product table (objectif / réalisé / % / reste à faire par jour, caisses and DA), his dated routes with history (40c).

### 40g — Debvora app (Flutter)
Same rules as phase 39 (keep the design system, `RoleScreens` table, the app hides, the API enforces). Load the UI skills and `design-upgrade` first.
- Add `AREA_MANAGER` and `PREVENDEUR` to `fieldRoles` and `RoleScreens`.
- **Vendeur / pré-vendeur home**: today's route (canal, commune), visits done / left, Nb BL (vendeur) or commandes (pré-vendeur), % of his month objective + % per product (big bars), reste à faire par jour.
- **Mes routes**: a date strip (past and next 7 days), each date = route name + counts; tap → the stops in order with status chips (icon + word), tap a client → existing client screen (sale for vendeur, commande for pré-vendeur). A past day is read-only.
- **Pré-vendeur**: no truck tab, no versement, no van sale; the commande screen shows "sera livrée le <date> par <livreur>" after confirm.
- **Livreur**: today's deliveries grouped by pré-vendeur, in route order (40d).
- **Superviseur home** and **chef de zone home**: the 40f homes in app form (KPI cards full width, member cards, ranking; the map only if `flutter_map` already in `pubspec.yaml` fits, else a list of communes with coloured % chips). Superviseur actions: move a seller to another zone (40b), change a pré-vendeur's livreur (40d), edit one day of a route (40c), enter targets (simplified grid: one member at a time, families then products).
- Strings in the app's `ar` / `fr` / `en` JSON (parity test). Widget tests for the role → screens table and the KPI card states; check on a 360 px emulator in Arabic.

### Order of work
40a → 40b → 40c → 40d → 40e → 40f → 40g. One PR each; 40a, 40b, 40c, 40d, 40e have migrations → `db:deploy` on Neon before each merge. If 40a's commune review (`docs/review/communes-59-69.md`) is not approved by the owner yet, merge 40a with the 59–69 communes behind a check that refuses them (`COMMUNE_UNDER_REVIEW`), never with an unreviewed list silently live.

### Tests (on top of each sub-phase's own tests above)
- Integration (real DB), one fixed seed: 2 wilayas (one of 59–69), 2 AREA zones, 3 CITY zones, 1 chef de zone, 2 superviseurs, 4 vendeurs, 2 pré-vendeurs, 2 livreurs, routes with canals, overrides, sales, commandes, visits, targets per product / family:
  - zone scope: a vendeur moved from Boussaâda to M'Sila sees only M'Sila clients the minute after, still sees his own past Boussaâda BL; a client without commune is hidden from him and listed for the superviseur;
  - a sale made by team A in team B's commune counts for team A in every figure; the commune filter shows it under its commune;
  - chef de zone sees only his area; superviseur only his team; a vendeur's member page is refused to another superviseur; tenant isolation on every new endpoint;
  - the planned visits count on the seller's route screen = the phase 37 stat = the superviseur's member card;
  - targets: Σ members vs team "reste à répartir"; edit outside scope refused; copy previous month audited;
  - forecast and per-day figures on a fixed "today" (inject the clock), including today = Friday and a holiday;
  - pré-vente confirm → livreur + next working day; idempotent replay; reassign by superviseur;
  - additivity contract test green for every new measure × dimension.
- Playwright mobile (docs/ui.md): `/statistiques`, `/statistiques/kpi/[measure]`, superviseur home, chef de zone home, `/objectifs`, `/equipe/[userId]` at 360 and 393 px in `ar` and `fr`, no sideways scroll, KPI numbers not cut; 1280 px still right. Lighthouse mobile on `/statistiques` ≥ 80; run the Cloudflare audit skill on the changed pages.

### Not in this phase (Parked ideas — the owner asked to keep them for later)
Monthly **plan d'action** (constat / objectif / action / responsable / avancement), the superviseur's **weekly planning** (jour / programme / lieu / objectif / statut), **veille concurrentielle** (competitor prices and presence), Excel export in the SVP layout, Excel import of the company's objectives, `CAISSES` in bonus rules, changing a route's seller for one day only, "prix par canal" price lists (check whether phase 20 price levels already cover it), aide vendeur.

### Definition of done
AGENTS.md §10, for each sub-phase. Each summary ends with What / How to test manually (including `db:deploy` on Neon and `db:backfill-communes` for 40a) / Decisions / Next sub-phase.
