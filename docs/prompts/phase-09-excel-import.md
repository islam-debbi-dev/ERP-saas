Read AGENTS.md and docs/domain.md before doing anything.

## Task: Phase 9 — Excel import (products, opening stock, opening client balances)

Branch: `phase-09-excel-import`. Phases 1–8 are merged.
Why this is MVP: no grossiste switches software without importing his products and his credit book.

### Domain rules to respect
- Three imports: **Produits** (reference, désignation, catégorie, unité de base, colisage carton/fardeau with factor, codes-barres, prix par niveau, TVA, stock min), **Stock initial** (reference, quantité, unité, coût unitaire), **Soldes clients** (code, nom, téléphone, adresse, plafond, solde initial).
- Flow: upload (.xlsx and .csv) → column mapping (auto-detect French headers, user can remap) → **preview with per-row validation** (errors and warnings, nothing written) → confirm → write.
- Confirm runs in **one transaction per import** (all or nothing) for up to ~10 000 rows; chunk the inserts but keep one transaction. Reuse `StockService` (OPENING) and `ClientAccountService` (OPENING), never write ledgers directly.
- Matching: products by reference (update existing master data, never touch existing stock/ledger); clients by code. Opening stock/balance refused for rows that already have one (reported, not silently skipped).
- Number parsing tolerant of Algerian/French formats: `1 234,50`, `1.234,50`, `1234.5`, `1 234 DA`. Money parsed with the money helpers, never `parseFloat`.
- Every import stored as an `ImportJob` (type, file name, row counts, errors, createdBy) for audit; the original file kept for 30 days.
- Downloadable templates (.xlsx) for each import with example rows.

### API
- `POST /imports/:type/preview` (multipart), `POST /imports/:id/confirm` (idempotent), `GET /imports`, `GET /imports/templates/:type`.
- Use a maintained xlsx parser (e.g. `exceljs`); file size limit 10 MB.

### Web
- Paramètres > Import: choose type, upload, mapping screen, preview table with red/yellow rows and error messages, confirm, result summary.

### Tests
- Unit: number parser (all formats above + invalid), header auto-detection.
- Integration: preview writes nothing; confirm imports 1 000 rows in one transaction; a failing row at confirm time rolls back everything; re-importing the same client file doesn't double opening balances; idempotent confirm; tenant isolation.

### Definition of done
AGENTS.md §10. Summary ends with What / How to test manually / Decisions / Next phase (Dashboard).
