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
| 13 | [Pilot & billing](prompts/phase-13-pilot-billing.md) | Subscription plans, trial, tenant suspension, onboarding checklist, support links | 12 | v1.1 |

**MVP = phases 1 to 12.** Put the pilot grossiste on it after phase 12; phase 13 can follow during the free pilot month.

## Order rationale
- Products → stock → purchases before sales, because a sale needs stock and cost (CUMP) to be right.
- Clients (5) only needs phase 1, so it can run in parallel with 2 to 4 if you want two branches.
- Excel import (9) comes after the data models it fills are stable, but before the pilot: no grossiste switches without importing his credit book.
- Printing (8) is its own phase because the A4/A5 layouts and Algerian legal fields take real iteration.

## v1.1 (after the pilot is live)
- Supplier accounts (supplier ledger, payments to suppliers).
- Client aging (0–30, 31–60, 61–90, 90+ days) and reminders.
- WhatsApp share of relevé and facture (link to PDF).
- Price history and bulk price update (by % or by category).
- Multiple caisses / sessions de caisse (cash register open/close).
- Phase 13 billing if not done yet.

## Later
- Flutter mobile app (owner dashboard + vendeur on the road, order taking).
- Flutter desktop caisse with offline mode (SQLite/drift, operation queue, idempotent resync).
- Multi-dépôts (stock per warehouse, transfers).
- CRM (visits, tasks, notes per client).
- Thermal 80mm tickets.
- E-invoicing / tax exports if the law requires it.
