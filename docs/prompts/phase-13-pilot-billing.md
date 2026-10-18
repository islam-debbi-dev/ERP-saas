Read AGENTS.md before doing anything.

## Task: Phase 13 — Pilot onboarding & subscription billing (v1.1)

Branch: `phase-13-pilot-billing`. Production is live (phase 12).

### Rules
- `Plan` (name, monthly price in DZD, limits: users, products, documents per month) and `Subscription` per tenant (plan, status `TRIAL` / `ACTIVE` / `PAST_DUE` / `SUSPENDED`, currentPeriodEnd).
- New tenants start with a **30-day trial**. Pilot tenants can be set to free by a super-admin.
- Payment for MVP is **manual**: the super-admin records a payment (BaridiMob, virement, espèces) and extends the period. Online payment (CIB/Edahabia through a local gateway) is later; verify current gateway options and fees before choosing one.
- `PAST_DUE` → 7 days grace with a banner; `SUSPENDED` → **read-only** (users can still view and export their data, never locked out of their own records, no new documents).
- Super-admin area (separate role outside tenants, protected by 2FA): list tenants, usage, subscription, record payment, impersonate in read-only mode with audit log.
- Onboarding checklist on the dashboard for new tenants: fill company info, import products, import client balances, create a user, make a first sale.
- Help: WhatsApp support link and links to short tutorial videos in the sidebar.

### Tests
- Integration: trial expiry → PAST_DUE → SUSPENDED transitions (time-mocked); suspended tenant can read and export but every write returns `SUBSCRIPTION_SUSPENDED`; super-admin actions audited; tenant users can't reach super-admin endpoints.

### Definition of done
AGENTS.md §10. Summary ends with What / How to test / Decisions / Next (v1.1 backlog in ROADMAP.md).
