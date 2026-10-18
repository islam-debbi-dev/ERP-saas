Read AGENTS.md before doing anything.

## Task: Phase 11 — Users, permissions, audit log, sessions

Branch: `phase-11-users-audit`. Phases 1–10 are merged.

### Rules
- OWNER invites users (name, phone or email, role). Invitation link with expiry, or owner sets an initial password the user must change at first login.
- Roles: OWNER (everything, one per tenant at least, cannot be removed by others), MANAGER, SELLER, STOREKEEPER. Default permission matrix in `packages/shared/permissions.ts`.
- Sensitive permissions, grantable per user on top of the role: `PRICE_OVERRIDE`, `DISCOUNT_ABOVE_X`, `CREDIT_OVERRIDE`, `SALE_CANCEL`, `PAYMENT_CANCEL`, `STOCK_ADJUST`, `VIEW_COST_AND_MARGIN`, `EXPORT_DATA`. Checked in services (not only in guards) and covered by tests.
- Deactivate a user = revoke all sessions immediately; never delete (their name stays on history).
- Sessions screen: device, IP, last activity; OWNER can revoke any session (lost phone).
- Audit log viewer: filter by user, entity, action, date; shows before/after diff. Read-only, OWNER/MANAGER only. Audit rows are never editable or deletable, including by OWNER.
- Login protection: rate limit and temporary lock after repeated failures; log failed logins in the audit log.

### API
- `POST /users/invite`, `GET/PUT /users`, `POST /users/:id/deactivate`, `PUT /users/:id/permissions`, `GET /sessions`, `DELETE /sessions/:id`, `GET /audit-logs`.

### Web
- Paramètres > Utilisateurs (list, invite, role, permissions toggles, deactivate), Paramètres > Sessions, Paramètres > Journal d'audit.
- Hide actions the user can't do, but the API remains the guard.

### Tests
- Integration: each sensitive permission refused without it and allowed with it; deactivated user's refresh token fails; last OWNER can't be demoted; audit entries exist for every write path covered in previous phases (one test that walks a sale + versement + adjustment and checks the trail); tenant isolation of users and audit logs.

### Definition of done
AGENTS.md §10. Summary ends with What / How to test manually / Decisions / Next phase (Production readiness).
