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
| 19 | [Mobile vendeur (Flutter)](prompts/phase-19-mobile-vendeur.md) | Offline-first Android app: sync, outbox, sale / order / versement / visit, GPS, Bluetooth BL print, objectives | 16, 17, 18 | v2 |
| 20 | [Mode distributeur](prompts/phase-20-distribution-mode.md) | Promotions & UG, emballages consignés ledger, sell-out report par marque | 14, 15, 16 | v2 |
| 21 | [Crédit avancé](prompts/phase-21-credit-advanced.md) | Supplier ledger + règlements, client aging, relances WhatsApp, share links, cheques à échéance | 13b | v1.1 |
| 22 | [Importateur](prompts/phase-22-import-landed-cost.md) | Dossiers d'importation, devises + taux, coût de revient (landed cost) into CUMP, late costs | 13b, 21 | v2 |

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

## v1.1 backlog not covered by a phase yet
- Price history and bulk price update (by % or by category).
- Multiple caisses / sessions de caisse (cash register open/close).

## Later
- Flutter owner dashboard app (the vendeur app is phase 19).
- Flutter desktop caisse with offline mode (SQLite/drift, operation queue, idempotent resync).
- CRM (tasks, notes per client; visits are phase 16).
- Lots and dates de péremption (DLC), stock reservation on orders, route optimisation, payroll / CNAS, B2B ordering portal for retailers.
- Thermal 80mm tickets.
- E-invoicing / tax exports if the law requires it.
