Read AGENTS.md and docs/domain.md (Clients & credit, Suppliers) before doing anything.

## Task: Phase 21 — Crédit avancé: supplier accounts, aging, reminders

Branch: `phase-21-credit-advanced`. Phases 1–13b are merged. This phase is **core** (no feature flag): every plan needs it, so run it right after 13b even though its number is higher.

### Domain rules to respect
- **Supplier ledger** (dettes fournisseurs), same design as the client ledger: `SupplierLedgerEntry` append-only (tenantId, supplierId, signed amount, type `PURCHASE` / `PAYMENT` / `RETURN` / `OPENING` / `ADJUST` / `REVERSAL`, refType, refId, createdBy, createdAt) + cached `SupplierBalance` updated in the same transaction and reconcilable. Positive balance = we owe the supplier.
  - A validated bon de réception posts `+totalTtc` (or HT when the tenant is not assujetti, follow what the BR stores); a purchase return posts the negative.
  - `SupplierPayment` (règlement fournisseur): number `RGF-YYYY-000001` (new `DocType.RGF`), amount, mode (espèces, chèque, virement), reference, due date for cheques, status `VALID` / `CANCELLED`. Creating it posts `−amount`. Idempotent. Cancel = REVERSAL with reason, MANAGER+.
  - Opening supplier balances: Excel import gains a 4th type "Fournisseurs et soldes" (same preview/confirm rules as phase 9, matched by supplier code).
  - Backfill: a one-off migration script posts ledger entries for BRs that already exist, so balances are right from day one. It must be idempotent (skip BRs that already have an entry).
- **Client aging** (0–30, 31–60, 61–90, 90+ days): computed from unpaid documents using the phase 7 allocations (oldest first); unallocated credit reduces the oldest bucket. The client balance stays the ledger; aging is a view and must sum to the balance.
- **Reminders**: a list "Clients à relancer" (balance > 0 and oldest unpaid > N days, N tenant setting, default 30) with a WhatsApp button that opens `https://wa.me/<phone>?text=<message>` with a prefilled French/Arabic message and a link to the relevé PDF.
- **Shareable links**: the relevé and the facture PDF can be shared by a signed, expiring link (token in the URL, 7 days, revocable, no login). Store the token hashed. Opening it is logged.
- **Cheques à échéance**: dashboard card for client cheques and supplier cheques due in the next 7 days (client cheques exist since phase 7).

### API
- `POST /supplier-payments` (idempotent), `POST /supplier-payments/:id/cancel`, `GET /suppliers/:id/ledger` (cursor pagination), `GET /suppliers/balances`.
- `GET /reports/aging?asOf=` (clients), `GET /reports/supplier-aging?asOf=`, `GET /clients/to-remind`.
- `POST /share-links` (doc type + id) → URL; `DELETE /share-links/:id`; public `GET /s/:token`.

### Web
- Every screen follows [`docs/ui.md`](../ui.md): phone first (360 px, `ar` RTL), card lists below `md`, `ResponsiveDialog`, sticky main action. Load the UI skills before building screens and run the audit skill on them at the end.
- Supplier detail page: ledger with running balance, new règlement dialog, relevé fournisseur PDF.
- Aging report with buckets, Excel export.
- "À relancer" page with the WhatsApp button.

### Tests
- Playwright mobile (`e2e/web/mobile.spec.ts`): each new screen at 360 and 393 px in `ar` and `fr`, no horizontal overflow, main action visible; screenshots in `e2e/artifacts/mobile/`.
- Unit: aging buckets (partial payments, overpayment, avoirs), share token expiry.
- Integration: BR posts to supplier ledger; payment and cancel; idempotent replay; backfill script run twice gives the same balances; concurrent payments on one supplier; aging sums to the ledger balance; expired/revoked share link refused; tenant isolation (a token never opens another tenant's document).

### Not in this phase
SMS gateway, automatic scheduled WhatsApp sending (needs the WhatsApp Business API), interest on late payment (parked).

### Definition of done
AGENTS.md §10. Summary ends with What / How to test manually / Decisions / Next phase (14 Sales force foundation).
