Read AGENTS.md and docs/domain.md (Documents, Algerian invoice fields) before doing anything.

## Task: Phase 8 — Documents & printing (PDF A4/A5)

Branch: `phase-08-documents`. Phases 1–7 are merged.

### Domain rules to respect
- PDFs generated **server-side** so prints are identical on every machine. Use HTML templates rendered by headless Chromium (Playwright/Puppeteer in the api image) unless you have a strong reason for a PDF library; note the choice under Decisions.
- Documents: BL, Facture, Avoir, Bon de réception, Relevé de compte client, reçu de versement. Formats A4 and A5 (tenant default + choice at print).
- Header from tenant settings: raison sociale, adresse, téléphone, RC, NIF, NIS, AI, RIB (if set). Client block with their RC/NIF/NIS/AI for professionals.
- Lines: désignation, quantité, unité, P.U. HT, montant HT (+ TVA rate column if assujetti). Totals: HT, TVA by rate, timbre (factures only), TTC. **Montant en lettres** in French ("Arrêtée la présente facture à la somme de : … dinars algériens et … centimes").
- **Timbre fiscal**: implement as a configurable tenant rule (enabled, applies to cash-paid factures, rate per tranche, minimum, maximum). Do **not** hard-code the current loi de finances values; put the values in the seed as an example and add a note in README to verify them against the current law. Apply it at facture validation (phase 6 left the field ready) and include it in the ledger amount.
- Non-assujetti tenants: no TVA column, mention "Non assujetti à la TVA" (configurable text).
- A cancelled document prints with a visible "ANNULÉ" watermark. A reprint shows "DUPLICATA".
- Documents are rendered from the frozen data on the document, never from current product/client data.

### API
- `GET /documents/:type/:id/pdf?format=A4|A5`, `GET /clients/:id/statement/pdf?from=&to=`, `GET /payments/:id/receipt.pdf`.
- `numberToFrenchWords(amount)` in `packages/shared` with exhaustive unit tests (0, 1, 21, 71, 80, 81, 91, 100, 200, 1 000, 1 000 000, 2 000 000, decimals, large amounts).
- Render time target < 2 s; reuse one browser instance.

### Web
- "Imprimer" (A4/A5) buttons on sale, purchase, avoir, versement and relevé screens; opens the PDF in a new tab.
- Paramètres > Documents: default format, footer text, TVA mention, timbre rule.

### Tests
- Unit: amount in words, timbre calculation (tranches, min, max, disabled, non-cash payment).
- Integration: PDF endpoint returns `application/pdf` for each type; snapshot of the rendered HTML for one facture (assujetti and non-assujetti); timbre included in the ledger for a cash facture; tenant isolation on document access.

### Definition of done
AGENTS.md §10. Summary ends with What / How to test manually / Decisions / Next phase (Excel import).
