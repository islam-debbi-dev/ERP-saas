Read AGENTS.md and docs/domain.md (Clients & credit) before doing anything.

## Task: Phase 7 — Versements (client payments)

Branch: `phase-07-versements`. Phases 1–6 are merged.

### Domain rules to respect
- `Payment` (versement): number `VER-YYYY-000001`, clientId, amount (> 0), mode (`ESPECES`, `CHEQUE`, `VIREMENT`, later `CCP`/`BARIDIMOB`), date, reference (cheque number, bank, due date for cheques), note, receivedBy, status (`VALID`, `CANCELLED`, `BOUNCED`). Extend the model if phase 6 created it.
- Creating a versement: one transaction, ledger entry `−amount` type PAYMENT, number, audit log. Idempotent (offline resync and double clicks must never duplicate).
- Overpayment is allowed and leaves a negative balance (crédit en sa faveur); the UI warns before confirming.
- **Allocation** (optional, informational): link a versement to specific unpaid documents (oldest first by default). The balance stays ledger-based; allocation only feeds "reste à payer" per document and future aging.
- **Cheque impayé (bounced)**: marks the payment BOUNCED and posts a REVERSAL `+amount` entry with reason, plus optional bank fees as ADJUSTMENT. Never deletes the payment.
- **Cancel** (input mistake): REVERSAL entry, reason required, MANAGER+, same day only for SELLER-created entries unless MANAGER+.

### API
- `POST /payments` (idempotent), `POST /payments/:id/cancel`, `POST /payments/:id/bounce`, `GET /payments` (filters: client, mode, date, status, receivedBy), `GET /clients/:id/unpaid-documents`.
- Daily cash summary: `GET /payments/summary?date=` by mode and by user (for the closing of the day).

### Web
- Versements page: list + new versement dialog (client search, balance shown, amount, mode, cheque fields), from client detail page too.
- Cheques à encaisser view (cheques with due date, status).
- Journal de caisse du jour.

### Tests
- Integration: versement decreases balance; idempotent replay; 20 concurrent versements on the same client → correct balance; bounce restores the debt; cancel rules by role; allocation never changes the ledger balance; tenant isolation.

### Definition of done
AGENTS.md §10. Summary ends with What / How to test manually / Decisions / Next phase (Documents & printing).
