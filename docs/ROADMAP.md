# Roadmap

Goal: a reliable MVP in front of **one pilot grossiste** as fast as possible, then 5 to 10 paying clients.
Each phase is one branch, one PR and one Claude Code session. Prompts live in [`prompts/`](prompts/).

| # | Phase | Delivers | Depends on | Tag |
|---|---|---|---|---|
| 1 | [Foundation](prompts/phase-01-foundation.md) | Monorepo, infra, CI, auth, tenancy, numbering, idempotency, audit, web shell, settings | none | MVP |
| 2 | [Products](prompts/phase-02-products.md) | Products, categories, units & packaging, price levels, barcodes, TVA rate | 1 | MVP |
| 3 | [Stock](prompts/phase-03-stock.md) | Stock ledger, cached levels, opening stock, adjustments, inventaire, low-stock alert, CUMP | 2 | MVP |
| 4 | [Suppliers & purchases](prompts/phase-04-purchases.md) | Suppliers, bon de réception, purchase returns, stock in + CUMP | 3 | MVP |
| 5 | [Clients & credit](prompts/phase-05-clients.md) | Clients, price level, plafond, client ledger, opening balances, relevé (screen) | 1 | MVP |
| 6 | [Sales](prompts/phase-06-sales.md) | Bon de livraison, facture (direct or from BLs), partial payment, cancel, retour/avoir, fast sale screen | 3, 5 | MVP |
| 7 | [Versements](prompts/phase-07-versements.md) | Payments by mode, allocation, cheque bounce reversal, overpayment | 5, 6 | MVP |
| 8 | [Documents & printing](prompts/phase-08-documents.md) | Server-side PDF A4/A5 for BL, facture, avoir, BR, relevé; montant en lettres; timbre fiscal rule | 6, 7 | MVP |
| 9 | [Excel import](prompts/phase-09-excel-import.md) | Import products, opening stock and opening client balances with preview + validation | 2, 3, 5 | MVP |
| 10 | [Dashboard & reports](prompts/phase-10-dashboard.md) | Sales today/month, credit outstanding, top debtors, low stock, margin, sales by product/client | 6, 7 | MVP |
| 11 | [Users, permissions, audit](prompts/phase-11-users-audit.md) | Invite users, roles, sensitive-action permissions, audit log viewer, sessions screen | 1 | MVP |
| 12 | [Production readiness](prompts/phase-12-production.md) | Deploy staging + prod, backups + PITR, restore drill, monitoring, rate limits, RLS, security pass | all | MVP |
| 12b | [Phone-ready UI](prompts/phase-12b-mobile-ui.md) | Audit and fix every screen at 360 px in `ar`/`fr`: card lists, responsive dialogs, sticky actions, Playwright mobile checks, audit skill scores | 12 | MVP |
| 13 | [Pilot & billing](prompts/phase-13-pilot-billing.md) | Subscription plans, trial, tenant suspension, onboarding checklist, support links | 12 | v1.1 |
| 13b | [Plans & feature flags](prompts/phase-13b-feature-flags.md) | Editions Essentiel / Import / Distribution / Entreprise, `@RequireFeature` guard, per-tenant grants | 13 | v1.1 |
| 14 | [Sales force foundation](prompts/phase-14-sales-force.md) | `Sale.sellerId`, `Payment.collectedBy`, teams (`managerId`), SUPERVISOR / LIVREUR, brands, sectors, client assignment, seller scoping | 13b, 21 | v2 |
| 15 | [Multi-dépôts & véhicules](prompts/phase-15-warehouses-vehicles.md) | Warehouses (main / truck), stock per warehouse, chargement / déchargement, expand → backfill → contract | 14 | v2 |
| 16 | [Tournées, visites, commandes](prompts/phase-16-tournees-orders.md) | Routes, visits with outcome, bon de commande → BL, livreur, clôture de tournée with cash écart | 15 | v2 |
| 17 | [Géolocalisation](prompts/phase-17-geolocation.md) | Client GPS + change approval, GeoCheck on sale / versement / visit, flag or block, review map | 14 | v2 |
| 18 | [Objectifs & primes](prompts/phase-18-incentives.md) | Targets, configurable bonus rules (5 types + gates + cap), live progress, monthly run → approve → export | 14 | v2 |
| 19 | ~~[Mobile vendeur (Flutter)](prompts/phase-19-mobile-vendeur.md)~~ | **Replaced by phase 39** (never built) | 16, 17, 18 | v2 |
| 20 | [Mode distributeur](prompts/phase-20-distribution-mode.md) | Promotions & UG, emballages consignés ledger, sell-out report par marque | 14, 15, 16 | v2 |
| 21 | [Crédit avancé](prompts/phase-21-credit-advanced.md) | Supplier ledger + règlements, client aging, relances WhatsApp, share links, cheques à échéance | 13b | v1.1 |
| 22 | [Importateur](prompts/phase-22-import-landed-cost.md) | Dossiers d'importation, devises + taux, coût de revient (landed cost) into CUMP, late costs | 13b, 21 | v2 |
| 23 | [Bascule VPS](prompts/phase-23-vps-cutover.md) | Production moves from Vercel + Neon to the VPS stack: env audit, single-runner jobs, verified data move | 12, 22 | v2 |
| 24 | [Dépôts: équipes et accès](prompts/phase-24-warehouse-teams-access.md) | Dépôt = business unit (brands, categories, team), module permissions, OPERATE / VIEW_STATS access per dépôt, dépôt switcher | 15, 23 | v2 |
| 25 | [Charges et loyers](prompts/phase-25-expenses-rent.md) | Dépenses (ledger-style), baux with rent prorata, charges report | 24 | v2 |
| 26 | [Vue d'ensemble](prompts/phase-26-overview-dashboard.md) | One card per dépôt: CA, cash in/out, marge, charges, résultat net, créances, stock | 24, 25 | v2 |
| 27 | [Notifications WhatsApp](prompts/phase-27-whatsapp-notifications.md) | Tenant's own WhatsApp Cloud API number, outbox, cash in / out alerts, daily summary | 23, 25 | v2 |
| 28 | [Relances automatiques](prompts/phase-28-auto-reminders.md) | Scheduled debtor reminders on WhatsApp, per-client exclude / pause, preview and log | 21, 27 | v2 |
| 29 | [Édition mono-société](prompts/phase-29-single-company-edition.md) | `DEPLOYMENT_MODE=single`, signed license, installer for one company on its own VPS | 28 | v2 |
| 32 | [Verrouillage automatique](prompts/phase-32-idle-lock.md) | Idle lock screen enforced by the API, per-user PIN, lock across tabs, owner sets the delay | 11 | v1.1 |
| 30 | [Assistant IA](prompts/phase-30-ai-assistant.md) | In-app help assistant, any model provider chosen by the admin (Claude, Gemini, OpenAI-compatible; own key in single-company mode): how-to answers in ar / darja / fr, read-only questions on the user's own data, quotas per plan | 13b, 24 | v2 |
| 31 | [DRH: personnel et pointage](prompts/phase-31-hr-attendance.md) | Employés, pointage du jour présent / absent (manager or self check-in with GPS), congés ledger, avances sur salaire | 24, 25 | v2 |
| 31b | [DRH: paie](prompts/phase-31b-payroll.md) | Monthly payroll run from the pointage, CNAS + IRG as dated rate sets, bulletin de paie PDF, salary payments, CNAS / IRG / DAS exports | 31 | v2 |
| 33 | [Tableau de bord interactif](prompts/phase-33-interactive-dashboard.md) | Every figure links to its filtered list, "À faire aujourd'hui" with one-tap actions, period switcher and tappable chart, top lists, auto refresh, monthly goal, per-user card layout | 21, 26 | v1.1 |
| 34 | [Trésorerie](prompts/phase-34-treasury.md) | Caisses and bank accounts with balances, cash ledger, transfers, comptage, paid-at-reception RGFs, import costs paid now | 21, 22, 24, 25, 31b | v2 |
| 35 | [Carte des clients](prompts/phase-35-client-map.md) | Map of the clients in the user's scope with filters, "près de moi" by straight-line distance, pick tournée stops on the map, order stops by proximity | 14, 16, 17 | v1.1 |
| 36 | [Distribution par véhicule](prompts/phase-36-vehicle-first-distribution.md) | Tenant-defined vehicle types and codes, truck identity (wilaya, plate, capacity), driver history, tournées planned per truck, truck frozen on visits and orders | 15, 16, 24 | v2 |
| 37 | [Statistiques distribution](prompts/phase-37-distribution-statistics.md) | `/statistiques`: one measure / dimension engine, per truck / type / dépôt / wilaya / family / segment, visits funnel, delivery rate, loads, avaries, targets per truck, récap journée véhicule, shadcn charts | 36 | v2 |
| 38 | [Offres sur mesure](prompts/phase-38-platform-packages.md) | Super-admin package templates (plan + edition + modules + limit overrides + custom price), usage per company, platform overview (MRR), announcements | 13b | v2 |
| 39 | [Application mobile terrain](prompts/phase-39-mobile-field-app.md) | The Flutter app in `apps/mobile` (theme and structure kept) rewired to this API: vendeur / livreur / superviseur screens per role, van sale, prévente, livraison from the truck, versements, visits, GPS, team day and cash closing, AI assistant; offline as an optional last step | 16, 17, 18, 30, 36 | v2 |

**MVP = phases 1 to 12b.** Put the pilot grossiste on it after phase 12b (traders open it on their phones); phase 13 can follow during the free pilot month.

Every phase that adds a screen follows [`ui.md`](ui.md): phone first, RTL, Playwright mobile checks.

## Order rationale
- Products → stock → purchases before sales, because a sale needs stock and cost (CUMP) to be right.
- Clients (5) only needs phase 1, so it can run in parallel with 2 to 4 if you want two branches.
- Excel import (9) comes after the data models it fills are stable, but before the pilot: no grossiste switches without importing his credit book.
- Printing (8) is its own phase because the A4/A5 layouts and Algerian legal fields take real iteration.

## After the MVP: recommended order
**12b → 13 → 13b → 21 → 14 → 17 → 18 → 15 → 16 → 19 → 20**, and **22** right after 21 if the first paying client is an importer.
- 13b first: every later phase declares its feature flag.
- 21 is core (supplier debts and aging are wanted by every plan), so it comes before the distributor phases despite its number.
- 17 and 18 only need 14 and work from the web; do them early if a distributor wants bonuses or GPS before the mobile app.
- 19 (Flutter) waits until the API it needs (14–18) is stable and tested from the web.

## After phase 22 (plan of 2026-11-01)
**23 → 24 → 25 → 26 → 27 → 28 → 29.**
- 23 first: every later phase assumes a long-running server (jobs, PDFs) and the data on the VPS.
- Decisions taken with islam: one client account across dépôts; one role per user; each company connects and pays for its own WhatsApp number; the single-company edition comes last and is sold without yearly maintenance.
- Start Meta Business verification for a pilot company early: it takes days and blocks 27–28.

## v1.1 backlog not covered by a phase yet
- Price history and bulk price update (by % or by category).
- Multiple caisses / sessions de caisse (cash register open/close).
- Online subscription payment (CIB / Edahabia through a local gateway such as SATIM-based providers or Chargily): verify the current options and fees first. Phase 13 records payments by hand.
- Tenant uploads a payment proof (photo of the BaridiMob receipt) from Paramètres > Abonnement, instead of sending it on WhatsApp.
- Edit plans and prices from the admin area (phase 13: rows of the `plans` table).
- Hide or disable write buttons while a company is suspended (phase 13: the API refuses with a clear message and a banner explains).
- TOTP replay protection (remember the last used step per admin) and admin 2FA enrolment from the UI.

## Later
- **RH / DRH**: now phases 31 (personnel, pointage, congés, avances) and 31b (paie). Have a comptable validate the CNAS / IRG rules before the first real payslip.
- **Online shop (phase 30 when needed)**: a separate storefront repo (Next.js) that reads catalog, prices and stock from the ERP and sends orders into it as `Order` with source WEB (phase 16 flow: confirm → BL). ERP side: public API with hashed per-tenant API keys, catalog / stock endpoints, idempotent `POST` order, status webhook. The same API can serve WooCommerce or Shopify connectors.
- Flutter owner dashboard app (the vendeur app is phase 19).
- Flutter desktop caisse with offline mode (SQLite/drift, operation queue, idempotent resync).
- CRM (tasks, notes per client; visits are phase 16).
- Lots and dates de péremption (DLC), stock reservation on orders, route optimisation, B2B ordering portal for retailers.
- Thermal 80mm tickets.
- E-invoicing / tax exports if the law requires it.

## Phase 30 (plan of 2026-11-04)
- Independent of 23, 27, 28: can be built any time after 26.
- Read-only by design: the assistant never creates or changes business data.

## Phase 33 (plan of 2026-11-07)
- The owner finds the dashboard boring and static. Phase 33 makes it the place the trader starts his day: drill-down on every number, an action list, interactive period and chart, a live feel. It writes nothing itself. Prompt: [`phase-33-interactive-dashboard.md`](prompts/phase-33-interactive-dashboard.md).

## Phase 34 (plan of 2026-11-06)
- Trésorerie: caisses and bank accounts with balances, paid-at-reception BRs become règlements, import costs paid at the port, transfers, cash count. Prompt: [`phase-34-treasury.md`](prompts/phase-34-treasury.md). Fixes the gaps listed in `docs/guide-workflow-ar.md` §10. Replaces "Multiple caisses" in the v1.1 backlog, except sessions de caisse.

## Phase 35 (plan of 2026-11-10)
- The owner wants to see on a map who is near, and to pick a tournée's clients on the map. Read-only map on top of the phase 17 points; stops still saved through `PUT /routes/:id/stops`. No routing API, no new dependency, one additive index (run `db:deploy` on Neon after merge). Prompt: [`phase-35-client-map.md`](prompts/phase-35-client-map.md).

## Phases 36–38 (plan of 2026-11-12)
- Big distributors follow the **truck**, not the worker (staff turnover). Phase 36 makes the vehicle the unit of distribution (codes and types typed by the company, one responsible driver, history kept), phase 37 builds statistics a director can trust on top of it (one definition per figure, totals that add up, sober shadcn charts, no decorative animation, no paid UI kit), phase 38 gives the super-admin a package per client. Order: 36 → 37 → 38 (structure first, selling later). Each adds an additive migration: run `db:deploy` on Neon after merge.
