Read AGENTS.md, docs/architecture.md (Tenancy, Super-admin) and docs/ui.md before doing anything. Then read `packages/shared/src/features.ts` (editions, `effectiveFeatures`), `packages/shared/src/subscription.ts`, `packages/shared/src/schemas/admin.ts` and `billing.ts`, `apps/api/src/billing/` (`plans.ts`, `billing.service.ts`: `statusOf`, `assertWritable`, `assertCanAdd`), `apps/api/src/auth/feature.guard.ts`, `apps/api/src/admin/` (all files: TOTP login, `AdminTenantsService`, `PlatformAuditService`, impersonation), `apps/api/prisma/schema.prisma` (`Plan`, `EditionPrice`, `Subscription`, `SubscriptionPayment`, `PlatformAdmin`, `PlatformAuditLog`, `Tenant.featureGrants` / `featureRevokes`), and the web admin under `apps/web/src/app/(admin)/admin/` (`societes`, `societes/[id]`). Use the `/graphify` graph first.

## Task: Phase 38 — Offres sur mesure et contrôle super-admin

Branch: `phase-38-platform-packages`. Independent of phases 36–37 (it only needs their feature flag to exist when it is merged after them; if 37 is not merged yet, the new `DISTRIBUTION_STATS` flag simply is not in the list). Phases 19, 23, 27, 28, 29 and 32 are not built: do not build any part of them. Production is Vercel + Neon: no timers, no background jobs.

### Why
Today a company's offer = one **plan** (Starter / Pro / Business: price + limits, defined in code) × one **edition** (Essentiel / Import / Distribution / Entreprise: modules) + per-company feature grants / revokes. That is enough for small grossistes, not for the big distributor who negotiates: "12 users, 25 trucks, statistics and GPS but no paie, 18 000 DA / month". The super-admin (the platform owner) must be able to build **a package per client**, reuse it for the next client of the same kind, see what each company uses, and talk to every company (maintenance, news), without touching code or the database by hand. Big clients also judge the vendor on control and transparency: every admin change is visible and audited.

### Rules
- **Platform data vs tenant data**: package templates and announcements are platform tables (no `tenantId`, like `plans`), written only by the super-admin API behind TOTP login. A tenant never reads another tenant's offer.
- **Nothing silent**: every admin change (template create / edit, apply to a company, price, limits, features, announcement) writes `PlatformAuditLog` with before / after in the same transaction.
- **A package is copied, not linked live**: applying a template copies its values onto the company's subscription (snapshot, like frozen document lines). Editing a template later never changes existing clients; the company page shows "différent du modèle X" and a "Réappliquer le modèle" action with a diff preview.
- **Taking a feature away never deletes data.** A revoked module is hidden and its routes refuse (existing guard); its data stays and comes back when re-granted. The admin sees, before saving, what the company will lose access to and how many rows it has there (e.g. "HR: 14 employés, 3 bulletins") and must confirm.
- **Lowering a limit below current usage** is allowed (negotiation happens) but never removes anything: the company just cannot add more (existing `PLAN_LIMIT_REACHED` behaviour), and the admin sees a warning with current usage first.
- **Money**: prices are `Decimal(14,2)` through `packages/shared/money`; the effective monthly price is computed in one shared function and shown everywhere the same way.

### Effective offer (shared, pure, unit-tested)
`packages/shared/src/offer.ts`:
- `effectiveLimits(plan, overrides)`: each limit = the override when set (a number, or `null` meaning unlimited explicitly), else the plan's. Limits: `maxUsers`, `maxProducts`, `maxDocumentsPerMonth` (soft), `maxMobileSellers`, `aiQuestionsPerMonth`, and two new ones `maxWarehouses` (MAIN + SECONDARY) and `maxVehicles` (VEHICLE). The overrides object is validated by a zod schema with exactly these keys.
- `effectiveMonthlyPrice(plan, editionSupplement, customMonthlyPrice)`: the custom price when set, else plan + edition supplement (today's rule).
- `effectiveFeatures` stays as it is (edition + grants − revokes).

### Schema (one migration, additive only)
- `package_templates` (platform): `id, code VarChar(30) unique, name VarChar(80), description VarChar(500)?, planId, edition Edition, featureGrants String[], featureRevokes String[], limitOverrides Json default '{}', customMonthlyPrice Decimal(14,2)?, active, createdAt, updatedAt`.
- `subscriptions`: `packageTemplateId Uuid?` (where it came from), `customMonthlyPrice Decimal(14,2)?`, `limitOverrides Json default '{}'`, `adminNote VarChar(1000)?` (private note: contract, contact, what was promised).
- `platform_announcements` (platform): `id, level (INFO | WARNING | MAINTENANCE), title / body in ar, fr, en, startsAt, endsAt, audience (ALL | EDITIONS | TENANTS), editions Edition[], tenantIds Uuid[], createdBy, createdAt, cancelledAt?`. Append-style: an announcement is cancelled, not deleted.
- `Plan` gains `maxWarehouses Int?` and `maxVehicles Int?` (null = unlimited, so current plans keep their behaviour); set real values in `plans.ts` only if the platform owner gives them (default null, write it under Decisions).
- After merge: `pnpm --filter @erp/api db:deploy` on Neon (PR "How to test" and summary).

### API
- Super-admin (`@AdminController`, existing guard + TOTP session):
  - `GET/POST/PATCH /admin/package-templates`, archive (`active = false`).
  - `POST /admin/tenants/:id/apply-package` `{ templateId }` → returns the new `SubscriptionSummary`; `GET /admin/tenants/:id/apply-package/preview?templateId=` → the diff (features gained / lost with row counts, limits before / after with current usage, price before / after).
  - `PATCH /admin/tenants/:id/subscription` (existing) gains `customMonthlyPrice` (or `null` to clear), `limitOverrides`, `adminNote`; same diff preview endpoint for a manual change (`POST /admin/tenants/:id/subscription/preview`).
  - `GET /admin/tenants/:id/usage`: users (active / limit), dépôts, trucks, products, mobile sellers, documents this month, AI questions this month, last activity (last login, last validated document), and per feature module a row count (cheap `count`s, run in parallel, under 500 ms).
  - `GET /admin/features`: the catalogue: every `Feature` with its label, description, editions that include it, and how many companies have it on (effective).
  - `GET /admin/overview`: companies by status / edition, MRR (Σ effective monthly price of ACTIVE, non-free companies), trials ending in 7 days, companies over a soft limit, companies inactive for 14 days. Computed on the fly (few hundred tenants), no cache table.
  - `GET/POST /admin/announcements`, `POST /admin/announcements/:id/cancel`.
- Tenant side:
  - `BillingService.assertCanAdd` uses `effectiveLimits` (not `plan.max*` directly) and gains `warehouses` and `vehicles` resources; the warehouses service calls it on create (lock the subscription row as today). Existing tests for users / products must stay green.
  - `GET /me/announcements`: active announcements for the user's company (by time, audience), max 3; the web shows them as a dismissible banner (dismissal stored per user in `localStorage` only; MAINTENANCE cannot be dismissed while active).
  - The tenant's own "Abonnement" settings page shows the effective offer: modules, limits with usage bars, monthly price, and, when a package was applied, its name. Never the admin note.
- Error codes in `packages/shared/errors.ts` for any new refusal (e.g. `PACKAGE_TEMPLATE_INACTIVE`, `LIMIT_OVERRIDES_INVALID`).

### Web (super-admin)
Follow [`docs/ui.md`](../ui.md) (the admin is used from a phone too): 360 px, `ResponsiveDialog`, card lists below `md`. Load the UI skills before building, audit at the end.
- **Tableau de bord plateforme** (`/admin`): the overview figures as cards, each a link to the filtered companies list.
- **Offres / modèles** (`/admin/offres`): list + editor (plan, edition, a module grid with three states per feature: *selon l'édition* / *activé* / *désactivé*, limits with "selon le plan" or a number or "illimité", optional custom price, live "prix effectif" from the shared function). "Dupliquer" to start a new template from an existing one.
- **Fiche société** (`/admin/societes/[id]`), new sections:
  - *Offre*: current plan, edition, template (with "différent du modèle" badge), effective price, "Appliquer un modèle…" → diff preview → confirm.
  - *Modules*: the same three-state grid, effective result shown next to each, diff preview with the row counts before saving.
  - *Limites*: each limit with current usage bar and override field.
  - *Utilisation*: the usage panel and last activity.
  - *Note interne*: the admin note (private).
  - *Historique*: the platform audit rows for this company (cursor pagination).
- **Modules** (`/admin/modules`): the feature catalogue with counts, a link to the companies that have each one.
- **Annonces** (`/admin/annonces`): create (three languages, level, dates, audience), list, cancel; preview of the banner in `ar` and `fr`.
- Admin UI strings in the three messages files like the rest of the admin.

### Tests
- Unit (shared): `effectiveLimits` (override number, override explicit null = unlimited, no override = plan), `effectiveMonthlyPrice` (custom vs plan + supplement, decimals), limit-overrides zod schema (unknown key refused, negative refused), announcement audience matcher (time window, edition, tenant list).
- Integration (API, real DB):
  - apply a template: subscription gets the snapshot, audit row has before / after, editing the template afterwards changes nothing on the company, re-apply works and is audited;
  - preview diff lists lost features with row counts and limits below usage;
  - limit override: a company with `maxVehicles = 2` override cannot create a 3rd truck (`PLAN_LIMIT_REACHED`), two concurrent creations cannot both take the last slot (subscription row lock), lowering below usage keeps everything readable;
  - custom price shows in the tenant's subscription summary and in MRR; free companies are excluded from MRR;
  - revoking a feature hides its routes (feature guard) and keeps its rows; re-granting brings them back unchanged;
  - announcements: audience by edition / tenant, time window, cancelled ones never returned, a tenant never sees another tenant-targeted announcement;
  - only an authenticated super-admin (TOTP session) reaches `/admin/*`; a tenant OWNER token is refused; the admin note never appears in any tenant DTO;
  - tenant isolation: usage endpoint counts only the target company's rows.
- Playwright mobile: `/admin/offres` editor, fiche société sections, annonces form at 360 and 393 px (`fr` and `ar`), no horizontal overflow; the tenant banner at 360 px in `ar`.
- Playwright (`web.spec.ts`): admin creates a template → applies it to the demo company → logs in as the company: modules and limits match; admin posts a MAINTENANCE announcement → the company sees the banner.

### Not in this phase
Online payment of subscriptions (CIB / Edahabia / BaridiMob gateway), automatic invoices to tenants, several super-admin accounts with roles (support vs owner), a public pricing page generated from templates, per-tenant data export / deletion on demand (GDPR-style; worth its own phase for big-client trust), status page and SLA reporting. List them under "Parked ideas".

### Definition of done
AGENTS.md §10. Summary ends with What / How to test manually (including `db:deploy` on Neon) / Decisions / Next phase.
