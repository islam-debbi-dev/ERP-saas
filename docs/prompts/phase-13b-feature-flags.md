Read AGENTS.md before doing anything. Read `packages/shared/src/permissions.ts`: this phase copies its pattern.

## Task: Phase 13b — Plans and feature flags (one codebase, several editions)

Branch: `phase-13b-feature-flags`. Phase 13 (plans, subscriptions, super-admin) is merged.

### Why
We sell the same product to three kinds of companies: a small grossiste who buys from a distributor, an importer (China) who sells en gros, and a brand distributor with sellers and trucks. They must all run on **one codebase and one database**. A plan switches modules on; no fork, no per-client branch.

### Rules
- `packages/shared/src/features.ts`:
  - `Feature` const (same style as `Permission`): `SALES_FORCE`, `WAREHOUSES`, `TOURNEES`, `GEO_CHECK`, `INCENTIVES`, `MOBILE_APP`, `PROMOTIONS`, `PACKAGING`, `IMPORT_COSTS`. Everything built in phases 1–13 is core and has no flag.
  - `PlanCode`: `ESSENTIEL`, `IMPORT`, `DISTRIBUTION`, `ENTREPRISE`.
  - `PLAN_FEATURES: Record<PlanCode, readonly Feature[]>`:
    - ESSENTIEL: none (core only).
    - IMPORT: `IMPORT_COSTS`, `WAREHOUSES`.
    - DISTRIBUTION: `SALES_FORCE`, `WAREHOUSES`, `TOURNEES`, `GEO_CHECK`, `INCENTIVES`, `MOBILE_APP`, `PROMOTIONS`, `PACKAGING`.
    - ENTREPRISE: all features.
  - `effectiveFeatures(planCode, grants, revokes)` and `hasFeature(...)`, unit tested.
- Schema: `Plan.code PlanCode` (unique), `Tenant.featureGrants String[]`, `Tenant.featureRevokes String[]` (default `[]`), and `Plan.limits` gains `mobileSellers` (count, used from phase 19). Migration is expand-only; seed sets the code on existing plans.
- The **API enforces**: `@RequireFeature(Feature.X)` decorator + global guard, on controllers or routes. A tenant without the feature gets `403 FEATURE_NOT_IN_PLAN` (add to `packages/shared/errors.ts`). Load the tenant's features per request with a short in-memory cache (60 s) invalidated when the super-admin changes the plan or grants; never put features in the JWT (a plan change must apply without re-login).
- Turning a feature off **never deletes or hides data from export**: its screens and write routes are refused, its data stays in the DB and comes back when the feature is on again. Reports and Excel exports of existing data stay readable.
- Super-admin can change a tenant's plan and grant/revoke single features (e.g. ESSENTIEL + `GEO_CHECK`). Every change is audited (before/after).
- Trial (phase 13) runs on the plan chosen at signup.
- Signup / onboarding asks "Quelle est votre activité ?" with three choices (grossiste, importateur, distributeur de marque) and picks the default plan from it.

### Web
- `GET /me` returns `features: Feature[]`. A `useFeature(f)` hook; the sidebar and pages hide what is off, and a direct URL to a hidden page shows an "available in plan X" screen with the support link.
- Super-admin tenant page: plan selector + feature grant/revoke checkboxes.
- All new strings in ar / fr / en.

### Tests
- Unit: `effectiveFeatures` (plan defaults, grant, revoke, unknown strings ignored).
- Integration: a route decorated with a feature returns `FEATURE_NOT_IN_PLAN` for an ESSENTIEL tenant and works after a grant; cache invalidation after a plan change; tenant users cannot call the grant endpoints; changes audited; tenant isolation.

### Not in this phase
Online payment, usage-based billing, self-service plan upgrade (parked).

### Definition of done
AGENTS.md §10. Summary ends with What / How to test manually / Decisions / Next phase (21 Credit avancé, recommended before 14).
