Read AGENTS.md, docs/ui.md and docs/domain.md (Credit, Stock, Vue d'ensemble) before doing anything. Read `apps/web/src/components/dashboard/` (all three files), `apps/web/src/components/overview/sparkline.tsx`, `apps/web/src/lib/reports.ts`, `apps/api/src/reports/reports.controller.ts` and the dashboard service it calls, `DashboardDto` in `packages/shared/src/schemas/reports.ts`, `apps/web/src/components/layout/navigation.ts`, and the list pages the dashboard will link to (sales, clients, stock levels, versements, purchases). Load the UI / design skills before building screens.

## Task: Phase 33 — Tableau de bord interactif

Branch: `phase-33-interactive-dashboard`. Phases 1–32 are merged (34 may or may not be). No feature flag: this is the home page of every plan and edition. Each section below is one commit that builds and passes tests on its own, so the phase can ship in parts.

### Why
The owner says the dashboard is boring: it shows numbers and the user can do nothing with them. Today it is a wall of figures (`Stat` cards, one bar chart, two debtor tables). Nothing is clickable, the period is always "this month", and nothing tells the trader what to do next. The goal: the dashboard becomes **the place the trader starts his work** every morning, not a page he reads once.

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
- Each `Stat` card gets an optional `href`. With one, the whole card is a link (focus ring, `aria-label` "voir le détail : …", a small chevron that flips with `rtl:rotate-180`). Pressing it on a phone shows a pressed state.
- Links, all with the dashboard's active filters (seller, team, brand, period) carried in the URL:
  | Card | Goes to |
  |---|---|
  | Ventes du jour / du mois | `/ventes?from=&to=` (and `sellerId`, `brandId` when filtered) |
  | Marge, Résultat net | `/vue-ensemble?from=&to=` |
  | Encaissé aujourd'hui (each mode line) | `/versements?from=today&to=today&mode=` |
  | En caisse / en banque | `/tresorerie` (when phase 34 is merged, else no link) |
  | Crédit clients | `/clients?sort=balance_desc&hasBalance=1` |
  | Dépassement de plafond | `/clients?overLimit=1` |
  | Rupture / Stock bas | `/stock?level=out` / `/stock?level=low` |
  | A debtor row | `/clients/{id}` |
  | A cheque group | the client or supplier card (already linked) |
- The target lists must **read these filters from the URL** (`useSearchParams`, validated with the list's zod query schema; an unknown value is dropped, never an error) and show them as removable chips at the top. Most lists only keep filters in state today; move them to the URL so the back button and a shared link keep them. Add the missing API filters (`overLimit`, `hasBalance`, `level`) to the existing list endpoints with tests.

### 33.2 "À faire aujourd'hui" (action center)
A new card at the top of the dashboard, under the welcome line. At most 6 items, most urgent first, each one line: an icon, a short sentence, an amount or count, and **one** main button. "Voir tout" opens the full list in a `ResponsiveDialog`.

- New endpoint `GET /dashboard/todo` (same permission rules as `/dashboard`), returning typed items, not sentences (the web builds the text from messages files):
  | Item type | When | Main button |
  |---|---|---|
  | `CHEQUE_DUE` | client cheque due today or overdue, not cashed | "Encaisser" → the cheque on the client card |
  | `SUPPLIER_CHEQUE_DUE` | own cheque due within 2 days | "Voir" → supplier card |
  | `CLIENT_OVER_LIMIT` | balance > plafond | "Appeler" (`tel:`) and, if phase 27 is on, "WhatsApp" |
  | `CLIENT_LATE` | oldest unpaid amount older than the tenant's payment term (aging data, phase 21) | "Versement" → new versement with `clientId` prefilled |
  | `OUT_OF_STOCK_SOLD` | product out of stock that sold in the last 30 days | "Commander" → new purchase with the product and its usual supplier prefilled |
  | `ORDER_TO_CONFIRM` | orders waiting confirmation (phase 16) | "Confirmer" → the order |
  | `DRAFT_OLD` | own draft document older than 24 h | "Reprendre" → the draft |
- Each item has a stable `key` (type + id). The user can **swipe or tap "Plus tard"** to hide one until tomorrow (stored in `localStorage` per user and day: a per-device convenience, not business data). When the list is empty: a calm "Rien d'urgent aujourd'hui" with a small check, not a blank card.
- The count shows as a badge on the "Tableau de bord" item of the sidebar and of the phone bottom nav.
- Prefill: the target forms read `?clientId=`, `?productId=`, `?supplierId=` once on mount and fill the field (the user still confirms). Add it where missing.
- Tests: unit tests of the item rules (each type, ordering, the cap of 6), an integration test per type against the test DB, tenant isolation (tenant A never sees B's items), and a seller only sees items on his own clients.

### 33.3 Play with the data (period + interactive chart)
- **Period switcher** under the header: a segmented control `Aujourd'hui · 7 jours · Ce mois · Mois dernier · Personnalisé` (custom opens two date fields in a `ResponsiveDialog`). Kept in the URL (`?period=`) so a refresh keeps it. Extend `dashboardQuerySchema` with `period` / `from` / `to` (max range 366 days, in `Africa/Algiers` days); `previous` is the same length just before, so the trend compares like with like. Default stays "Ce mois".
- **Chart**: keep the plain-bar `SalesChart` (no chart library: the current one is light and RTL-correct), and make it interactive:
  - tap / focus a bar → a small label above it with the day, the TTC and the number of documents; arrow keys move between bars; a second tap opens `/ventes` for that day;
  - a toggle `Ventes · Encaissements` (and `Marge` with `VIEW_COST_AND_MARGIN`) switches the series; the API returns `perDay` with `ttc`, `cash` and `margin` (null without the permission);
  - the same days of the previous period as a faint outline behind each bar ("comparer" switch, off by default on phone);
  - one bar per day up to 31 days, per week above that.
  - The hidden table for screen readers stays.
- **Top lists** (new, small cards, 5 rows each, tap a row to open it): top products of the period (quantity and CA), top clients of the period, and "clients qui n'achètent plus": clients with a sale in the 90 days before but none in the last 30, sorted by their usual monthly CA. Computed in the reports service with the same seller/brand filters.

### 33.4 The page is alive
- **Auto refresh**: the dashboard and the todo queries refetch every 60 s **only while the tab is visible** (`refetchInterval` + `refetchIntervalInBackground: false`), and on window focus. Under the header: "Mis à jour il y a 2 min" with a refresh button (44 px, `aria-label`). On a phone, pull-to-refresh at the top of the page does the same.
- **Number change**: when a figure changes after a refetch, it counts from the old to the new value (≤ 300 ms, `tabular-nums`, no layout shift) and the card flashes its border once. Never on first load.
- **Goal of the month**: new tenant setting `monthlySalesTarget` (money string, optional) in `tenantSettingsSchema`, set by OWNER in Paramètres → Entreprise (audited, `TENANT_SALES_TARGET_CHANGED`). With a target, the "Ventes du mois" card shows a progress bar (`role="progressbar"`, value in text too, not colour alone), the percentage, and "il reste X DA en N jours" computed by the API. Sellers keep their own objectives card (phase incentives); the two never mix.
- **Greeting with a fact**: under "Bonjour {name}", one line chosen by the API from the data, e.g. "Meilleure journée du mois hier : 452 300 DA", "3 chèques à encaisser aujourd'hui", "Ventes +12 % par rapport au mois dernier". Deterministic rules, no AI, one per day, in the messages files with parameters.

### 33.5 My dashboard (customise)
- An "Organiser" button opens edit mode: each card shows a handle and an eye toggle. Reorder with `@dnd-kit` (already a dependency; keyboard sorting on, and up/down buttons on a phone because long-press drag fights scrolling), hide or show cards, "Rétablir par défaut".
- Stored **per user on the server** so it follows him from the PC to the phone: `User.dashboardLayout Json?` (additive migration, null = default order), validated by a zod schema of known card ids (unknown ids are dropped on read, so removing a card later never breaks a saved layout). `PATCH /users/me/dashboard-layout`, audited without before/after.
- The default order depends on the role: owner/manager start with "À faire" then money; a seller starts with "À faire", his objectives, then his sales; a magasinier starts with stock.

### Quick actions (in 33.2)
- Desktop: a row of 3–4 buttons in the `PageHeader` actions: Nouvelle vente, Versement, Achat, Nouveau client, filtered by role and features.
- Phone: one round "+" button bottom-end, above the bottom bar and the safe area, opening a bottom sheet with the same actions (big tiles, icon + label). It never covers the `StickyActions` of another page (dashboard only).

### Messages
Every new string in `apps/web/src/messages/{ar,fr,en}.json` under `dashboard.*` (the key-parity test must stay green). Darja-friendly Arabic: short, everyday words ("خلّص", "عيّط", "اطلب سلعة"), checked with the owner.

### Tests
- API unit: todo rules, period ranges in `Africa/Algiers` (month change, 31 → 30 days, previous period), trends and target remaining with `decimal.js`, greeting fact selection, layout schema dropping unknown ids.
- API integration (real Postgres): `/dashboard?period=` totals match the sales of the range; `/dashboard/todo` per item type; top products / dormant clients; seller scoping; tenant A / tenant B isolation on every new endpoint and on the new list filters; `PATCH dashboard-layout` only touches the caller.
- Web: drill-down hrefs carry the filters; list pages read and drop URL filters; bar keyboard navigation; reduced motion turns animations off.
- Playwright: dashboard in `ar` and `fr` at 360 and 393 px (no overflow, "+" sheet opens, a todo item's button lands on the prefilled form, edit mode reorders with the buttons); screenshot of each state in `e2e/artifacts/mobile/`. Lighthouse mobile on `/tableau-de-bord`: Performance ≥ 80, Accessibility ≥ 90 (write the scores in the PR).
- Run the Cloudflare audit skill on the dashboard and every list page that changed.

### Not in this phase (park them in the PR)
- Real-time push (websocket / SSE) of new sales: polling every 60 s is enough for a pilot.
- Badges, streaks, points for sellers (gamification): wait for the owner's feedback on 33.4.
- AI-written insights (phase 30 can reuse the greeting slot later).
- A chart library: only if 33.3's plain bars are not enough.

### Definition of done
AGENTS.md §10, plus: every card that shows a number has a link or a stated reason why not, the dashboard has at least one action for an owner on a normal day of the demo tenant (seed a due cheque, an over-limit client and an out-of-stock product that sold, idempotently), and a phone user can do the morning round (look, tap a todo, come back) with one thumb.
