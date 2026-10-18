Read AGENTS.md and docs/domain.md (Clients & credit) before doing anything.

## Task: Phase 5 — Clients, plafond, client ledger, relevé

Branch: `phase-05-clients`. Phase 1 is merged (phases 2–4 may or may not be).

### Domain rules to respect
- `Client`: code (unique per tenant), name, phone(s), address, wilaya/commune, type (particulier / professionnel), RC/NIF/NIS/AI for professionals, default `priceLevelId`, `creditLimit` (Decimal, null = no limit), notes, active, soft delete.
- `ClientLedgerEntry` is **append-only**: tenantId, clientId, amount (signed Decimal(14,2), positive = client owes more), type (`OPENING`, `SALE`, `PAYMENT`, `RETURN`, `ADJUSTMENT`, `REVERSAL`), refType, refId, label, createdBy, createdAt.
- `ClientBalance` cache updated in the same transaction, with a reconcile check like stock.
- Expose `ClientAccountService.post(tx, entries[])` (locks the balance row `FOR UPDATE`) and `ClientAccountService.checkCreditLimit(tx, clientId, additionalAmount)` returning `OK | WARN | BLOCK` according to `creditLimitMode`. Sales and versements (phases 6–7) must use these, never write entries themselves.
- **Opening balance**: one per client (can be negative = avoir in his favour). Corrections are ADJUSTMENT entries with a required reason and MANAGER+ permission.
- Negative balance (client paid more) is valid and shown as "crédit en sa faveur".

### API
- CRUD clients, search by code/name/phone, filters (has debt, over plafond).
- `POST /clients/:id/opening-balance`, `POST /clients/:id/adjustments` (idempotent).
- `GET /clients/:id/statement?from=&to=` → opening balance at `from`, entries with running balance, closing balance. Running balance computed in SQL (window function), not by loading everything in memory.
- `GET /clients/debtors` sorted by balance, for the dashboard later.

### Web
- Clients list with balance column, over-plafond badge, search.
- Client form, client detail page: info, balance, plafond usage bar, relevé de compte (screen version; PDF comes in phase 8).

### Tests
- Integration: opening balance once only; adjustment requires reason and role; balance cache = sum of ledger after many concurrent posts (20 parallel posts → correct balance); statement running balance correct across a date range; checkCreditLimit in WARN vs BLOCK; tenant isolation.

### Definition of done
AGENTS.md §10. Summary ends with What / How to test manually / Decisions / Next phase (Sales).
