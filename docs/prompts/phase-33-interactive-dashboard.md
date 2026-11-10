Read AGENTS.md, docs/ui.md and docs/domain.md (Credit, Stock, Vue d'ensemble) before doing anything. Read `apps/web/src/components/dashboard/` (all three files), `apps/web/src/components/overview/sparkline.tsx`, `apps/web/src/lib/reports.ts`, `apps/api/src/reports/reports.controller.ts` and the dashboard service it calls, `DashboardDto` in `packages/shared/src/schemas/reports.ts`, `apps/web/src/components/layout/navigation.ts`, and the list pages the dashboard will link to (sales, clients, stock levels, versements, purchases). Load the UI / design skills before building screens.

## Task: Phase 33 — Tableau de bord interactif

Branch: `phase-33-interactive-dashboard`. Phases 1–26, 30, 31, 31b and 34 are merged. Phases 19, 23, 27, 28, 29 and 32 are **not** built and this phase needs none of them: do not build any part of them here. No feature flag: this is the home page of every plan and edition.

**How to work**: build in this order: 33.1 → 33.2 (with the quick actions) → 33.3 → 33.4 → 33.5. Each section is one or more commits that build and pass `pnpm lint && pnpm typecheck && pnpm test` on their own, so the phase can ship in parts (a first PR after 33.2 is fine). Commit at the end of every section; if the session runs out, the next one resumes from `git log`.

**Where it runs today**: the API and the web are two separate Vercel projects on a Neon database (no VPS, no background jobs, no timers on the server). So: every DTO change is **additive** (the old web can call the new API for a few minutes during a deploy, and the assistant of phase 30 calls `DashboardService.periodSummary`), nothing in this phase needs a job, and polling must stay cheap (33.4).

### Why
The owner says the dashboard is boring: it shows numbers and the user can do nothing with them. Today it is a wall of figures (`Stat` cards, one bar chart, two debtor tables). Only a few things are clickable (`Stat` already takes an `href`: En caisse, Crédit clients, Rupture / Stock bas, debtor rows), the period is always "this month", and nothing tells the trader what to do next. The goal: the dashboard becomes **the place the trader starts his work** every morning, not a page he reads once.

The four ideas, in order of value:
1. **Every number is a door**: tap a figure, land on the list behind it, already filtered.
2. **"À faire aujourd'hui"**: a short list of things that need the user now, each with a one-tap action.
3. **The user plays with the data**: change the period, tap a day of the chart, compare with last month.
4. **The page is alive**: it refreshes by itself, says when it was updated, and shows progress towards a goal.

### Rules that do not change
- **The dashboard writes nothing.** Every action opens an existing screen (new sale, versement, purchase, client card) with fields prefilled from the URL. Money and stock writes keep going through their own forms, idempotency keys and transactions. No new POST with money or stock effects in this phase.
- **The API computes, the web draws.** Percentages, trends, "à faire" items and insights come from the API with `decimal.js`; the web never adds or divides money.
- **Permissions are the API's.** A seller still sees only his own figures; a section the role cannot see is `null` in the DTO and not drawn. A link to a page the user cannot open is not shown.
- **Phone first** (docs/ui.md): 360 px in `ar`, no sideways scroll, 44 px targets, nothing on hover only.
- **Motion is optional**: every animation is off under `prefers-reduced-motion: reduce`, and none lasts more than 300 ms.

### 33.1 Every number is a door (drill-down)
- `Stat` already has an optional `href`; keep it and finish it. With one, the whole card is a link (focus ring, `aria-label` "voir le détail : …", a small chevron that flips with `rtl:rotate-180`). Pressing it on a phone shows a pressed state.
- Links, all with the dashboard's active filters (seller, team, brand, dépôt, period) carried in the URL when the target list has that filter:
  | Card | Goes to |
  |---|---|
  | Ventes du jour / du mois | `/ventes?from=&to=` (and `sellerId`, `brandId` when filtered) |
  | Marge, Résultat net | `/vue-ensemble?from=&to=` |
  | Encaissé aujourd'hui (each mode line) | `/versements?from=today&to=today&mode=` |
  | En caisse / en banque | `/tresorerie` (already linked; only when `treasury` is not null) |
  | Crédit clients | `/clients?hasDebt=true` |
  | Dépassement de plafond | `/clients?overLimit=true` |
  | Rupture / Stock bas | `/stock?filtre=rupture` / `/stock?filtre=bas` (these links exist: keep the param, do not rename it) |
  | A debtor row | `/clients/{id}` |
  | A cheque group | the client or supplier card (already linked) |
- The target lists must **read these filters from the URL** (`useSearchParams`, validated with the list's zod query schema; an unknown value is dropped, never an error) and show them as removable chips at the top. Most lists only keep filters in state today; move them to the URL so the back button and a shared link keep them. **Reuse the filters the API already has** before adding one: `clientListQuerySchema` has `hasDebt` and `overLimit`, the stock levels query has `lowStock` and `outOfStock`. Check the sales and versements list schemas for `from` / `to` / `mode` / `sellerId` / `brandId` / `warehouseId`, add only what is missing, with tests, and never rename an existing query param.

### 33.2 "À faire aujourd'hui" (action center)
A new card at the top of the dashboard, under the welcome line. At most 6 items, most urgent first, each one line: an icon, a short sentence, an amount or count, and **one** main button. "Voir tout" opens the full list in a `ResponsiveDialog`.

- New endpoint `GET /dashboard/todo` (same permission rules as `/dashboard`), returning typed items, not sentences (the web builds the text from messages files):
  | Item type | When | Main button |
  |---|---|---|
  | `CHEQUE_DUE` | client cheque (`Payment` `CHEQUE`, `VALID`) with an échéance from 7 days ago to today. A cheque has no "encaissé" state in the schema: do not add one here (parked); the item leaves the list by date or with "Plus tard" | "Voir" → the cheque on the client card |
  | `SUPPLIER_CHEQUE_DUE` | own cheque due within 2 days | "Voir" → supplier card |
  | `CLIENT_OVER_LIMIT` | balance > plafond | "Appeler" (`tel:`) and "WhatsApp": a plain `https://wa.me/<number>` link built with `packages/shared/src/phone.ts`, no API and no message sent by us (phase 27 is not built) |
  | `CLIENT_LATE` | the rule of "Clients à relancer" that already exists (tenant setting `reminderDays`, page `/clients/a-relancer`): call that service, do not write a second rule. One item per client for the worst ones, and "Voir tout" for this type goes to `/clients/a-relancer` | "Versement" → new versement with `clientId` prefilled |
  | `OUT_OF_STOCK_SOLD` | product out of stock that sold in the last 30 days | "Commander" → `/achats/nouveau` with the product prefilled, and the supplier of its last validated purchase when there is one (a product has no "usual supplier" field; do not add one) |
  | `ORDER_TO_CONFIRM` | orders in `OrderStatus.DRAFT` (phase 16), only when the tenant has that module | "Confirmer" → the order |
  | `DRAFT_OLD` | own `DRAFT` sale or purchase older than 24 h | "Reprendre" → the draft |
- Each item has a stable `key` (type + id). The user can **swipe or tap "Plus tard"** to hide one until tomorrow (stored in `localStorage` per user and day: a per-device convenience, not business data). When the list is empty: a calm "Rien d'urgent aujourd'hui" with a small check, not a blank card.
- An item type whose module the tenant does not have, or whose page the role cannot open, is never returned.
- The count shows as a badge on the "Tableau de bord" item of the sidebar and, on a phone, as a dot on the menu button of `site-header.tsx` (the app has no bottom nav; do not add one). Outside the dashboard this count is fetched once with a 5 minute `staleTime` and no interval.
- Prefill: the target forms read `?clientId=`, `?productId=`, `?supplierId=` once on mount and fill the field (the user still confirms). Add it where missing.
- Tests: unit tests of the item rules (each type, ordering, the cap of 6), an integration test per type against the test DB, tenant isolation (tenant A never sees B's items), and a seller only sees items on his own clients.

### 33.3 Play with the data (period + interactive chart)
- **Period switcher** under the header: a segmented control `Aujourd'hui · 7 jours · Ce mois · Mois dernier · Personnalisé` (custom opens two date fields in a `ResponsiveDialog`). Kept in the URL (`?period=`) so a refresh keeps it. Extend `dashboardQuerySchema` with `period` / `from` / `to`, keeping `date` and `warehouseId` as they are and reusing the range rules of `overviewQuerySchema` (`MAX_REPORT_DAYS`, `Africa/Algiers` days) and the previous-period helpers of the Vue d'ensemble instead of writing new ones. Add the period figures as **new fields** of `DashboardDto`; `sales.today`, `month`, `previousMonth` and `perDay` keep their meaning; `previous` is the same length just before, so the trend compares like with like. Default stays "Ce mois".
- **Chart**: keep the plain-bar `SalesChart` (no chart library: the current one is light and RTL-correct), and make it interactive:
  - tap / focus a bar → a small label above it with the day, the TTC and the number of documents; arrow keys move between bars; a second tap opens `/ventes` for that day;
  - a toggle `Ventes · Encaissements` (and `Marge` with `VIEW_COST_AND_MARGIN`) switches the series; the API returns `perDay` with `ttc`, `cash` and `margin` (null without the permission);
  - the same days of the previous period as a faint outline behind each bar ("comparer" switch, off by default on phone);
  - one bar per day up to 31 days, per week above that.
  - The hidden table for screen readers stays.
- **Top lists** (new, small cards, 5 rows each, tap a row to open it): top products of the period (quantity and CA), top clients of the period, and "clients qui n'achètent plus": clients with a sale in the 90 days before but none in the last 30, sorted by their usual monthly CA. Computed in the reports service with the same seller/brand filters.

### 33.4 The page is alive
- **Auto refresh**: the dashboard and the todo queries refetch every 60 s **only while the tab is visible** (`refetchInterval` + `refetchIntervalInBackground: false`), and on window focus. Polling **stops after 5 minutes without user activity** (pointer, key, touch) and starts again on the next one: a dashboard left open all day on a counter PC must not keep the serverless API and the Neon database awake. Under the header: "Mis à jour il y a 2 min" with a refresh button (44 px, `aria-label`). On a phone, pull-to-refresh at the top of the page does the same.
- **Number change**: when a figure changes after a refetch, it counts from the old to the new value (≤ 300 ms, `tabular-nums`, no layout shift) and the card flashes its border once. Never on first load.
- **Goal of the month**: new tenant setting `monthlySalesTarget` (money string, optional) in `tenantSettingsSchema`, set by OWNER in Paramètres → Entreprise (audited, `TENANT_SALES_TARGET_CHANGED`). With a target, the "Ventes du mois" card shows a progress bar (`role="progressbar"`, value in text too, not colour alone), the percentage, and "il reste X DA en N jours" computed by the API. Sellers keep their own objectives card (phase incentives); the two never mix.
- **Greeting with a fact**: under "Bonjour {name}", one line chosen by the API from the data, e.g. "Meilleure journée du mois hier : 452 300 DA", "3 chèques à encaisser aujourd'hui", "Ventes +12 % par rapport au mois dernier". Deterministic rules, no AI, one per day, in the messages files with parameters.

### 33.5 My dashboard (customise)
- An "Organiser" button opens edit mode: each card shows a handle and an eye toggle. Reorder with `@dnd-kit` (already a dependency; keyboard sorting on, and up/down buttons on a phone because long-press drag fights scrolling), hide or show cards, "Rétablir par défaut".
- Stored **per user on the server** so it follows him from the PC to the phone: `User.dashboardLayout Json?` (additive migration, null = default order), validated by a zod schema of known card ids (unknown ids are dropped on read, so removing a card later never breaks a saved layout). `PATCH /users/me/dashboard-layout`, audited without before/after.
- The default order depends on the role: owner/manager start with "À faire" then money; a seller or a supervisor starts with "À faire", his objectives, then his (team's) sales; a magasinier starts with stock; a livreur with "À faire". The onboarding card is not part of the layout: it stays first until it is finished.

### Quick actions (in 33.2)
- Desktop: a row of 3–4 buttons in the `PageHeader` actions: Nouvelle vente, Versement, Achat, Nouveau client, filtered by role and features.
- Phone: one round "+" button bottom-end, above the safe area (`env(safe-area-inset-bottom)`), opening a bottom sheet with the same actions (big tiles, icon + label). It never covers the `StickyActions` of another page (dashboard only).

### Messages
Every new string in `apps/web/src/messages/{ar,fr,en}.json` under `dashboard.*` (the key-parity test must stay green). Darja-friendly Arabic: short, everyday words ("خلّص", "عيّط", "اطلب سلعة"), checked with the owner.

### Tests
- API unit: todo rules, period ranges in `Africa/Algiers` (month change, 31 → 30 days, previous period), trends and target remaining with `decimal.js`, greeting fact selection, layout schema dropping unknown ids.
- Speed: on the large data set used to measure the Vue d'ensemble in phase 26 (about 200 000 sales), `/dashboard` and `/dashboard/todo` each answer in 400 ms or less; write the numbers in the PR. Look at the plan of each new query (top products, dormant clients, todo) and add an index starting with `tenantId` in the phase's migration when one is missing. The todo queries run in parallel and each has a `LIMIT`.
- API integration (real Postgres): `/dashboard?period=` totals match the sales of the range; `/dashboard/todo` per item type; top products / dormant clients; seller scoping; tenant A / tenant B isolation on every new endpoint and on the new list filters; `PATCH dashboard-layout` only touches the caller.
- Web: drill-down hrefs carry the filters; list pages read and drop URL filters; bar keyboard navigation; reduced motion turns animations off.
- Playwright: dashboard in `ar` and `fr` at 360 and 393 px (no overflow, "+" sheet opens, a todo item's button lands on the prefilled form, edit mode reorders with the buttons); screenshot of each state in `e2e/artifacts/mobile/`. Lighthouse mobile on `/tableau-de-bord`: Performance ≥ 80, Accessibility ≥ 90 (write the scores in the PR).
- Run the Cloudflare audit skill on the dashboard and every list page that changed. If the skill or Lighthouse is not available in the session, say so in the PR under "Not done" instead of skipping it silently.

### Not in this phase (park them in the PR)
- Real-time push (websocket / SSE) of new sales: polling every 60 s is enough for a pilot.
- Badges, streaks, points for sellers (gamification): wait for the owner's feedback on 33.4.
- AI-written insights (phase 30 can reuse the greeting slot later).
- A chart library: only if 33.3's plain bars are not enough.
- An "encaissé" state on cheques, and a usual supplier on products.
- Todo items from other modules (congé to approve, loyer due, opérations signalées, paie to approve): after the pilot says which ones matter.
- Sending a WhatsApp message from the app (phase 27).

### Definition of done
AGENTS.md §10, plus: every card that shows a number has a link or a stated reason why not, the dashboard has at least one action for an owner on a normal day of the demo tenant (seed a due cheque, an over-limit client and an out-of-stock product that sold, idempotently), and a phone user can do the morning round (look, tap a todo, come back) with one thumb.
