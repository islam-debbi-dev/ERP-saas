Read AGENTS.md before doing anything.

## Task: Phase 10 — Dashboard & reports

Branch: `phase-10-dashboard`. Phases 1–9 are merged.

### What the owner must see in 5 seconds (Tableau de bord)
- Ventes aujourd'hui / ce mois (TTC, count), vs same period last month.
- Encaissements aujourd'hui by mode (from versements).
- **Crédit clients total** outstanding and the **top 10 débiteurs** (link to client).
- Clients over plafond.
- Produits en rupture / stock bas (count + link to filtered stock page).
- Marge brute du mois (sales HT − cost at sale snapshot).
- Valeur du stock at CUMP.

### Reports (Rapports page, each exportable to .xlsx)
- Ventes par période, par produit, par client, par vendeur.
- Marge par produit / catégorie.
- Mouvements de stock par période.
- Encaissements par mode / par utilisateur.
- Achats par fournisseur.

### Rules
- All figures computed from the ledgers and frozen document data, never from current prices.
- Cancelled documents excluded; returns/avoirs subtracted.
- Periods in `Africa/Algiers` time (a sale at 23:30 local belongs to that day).
- Queries must stay fast with 100k documents: aggregate in SQL, add the needed composite indexes (tenantId first), no N+1. Add an `EXPLAIN` check note in the PR for the two heaviest queries.
- Role-based: SELLER sees only his own sales figures; STOREKEEPER sees stock only; OWNER/MANAGER see everything.

### API
- `GET /dashboard`, `GET /reports/:name?from=&to=&groupBy=`, `GET /reports/:name/export.xlsx`.

### Web
- Dashboard cards + one bar chart (sales per day this month) + top debtors table. Keep it simple, French labels, amounts formatted `1 234 567,89 DA`.

### Tests
- Integration with a fixture of sales, returns, cancellations and versements across two months and two tenants: every dashboard figure equals a hand-computed expected value; day boundary in Algiers time; role filtering; tenant isolation.

### Definition of done
AGENTS.md §10. Summary ends with What / How to test manually / Decisions / Next phase (Users & audit).
