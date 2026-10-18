Read AGENTS.md fully before doing anything. Follow it for every decision.

## Task: Phase 1 — project foundation

Branch: `phase-01-foundation`.
Set up the monorepo and the foundation everything else will build on. Do not implement business modules yet beyond what is listed here.

### 1. Monorepo
- pnpm workspaces + Turborepo with `apps/api`, `apps/web`, `packages/shared`, `infra/`.
- Shared TypeScript config, ESLint + Prettier, strict mode on.
- Root scripts: `dev`, `build`, `lint`, `typecheck`, `test`, `db:migrate`, `db:seed`.

### 2. Infra
- `infra/docker-compose.yml` with Postgres 16 (+ a separate test DB), api and web.
- `.env.example` for api and web. No secrets committed.
- GitHub Actions workflow: install → lint → typecheck → test (with Postgres service) → build.

### 3. API foundation (NestJS + Prisma)
- Prisma schema with: `Tenant`, `User` (roles OWNER, MANAGER, SELLER, STOREKEEPER), `Session` (refresh tokens hashed, device info), `AuditLog`, `DocumentSequence`, `IdempotencyKey`, and the tenant settings fields (assujettiTva, creditLimitMode, negativeStockMode, priceLevelCount, invoice header: raison sociale, adresse, téléphone, RC, NIF, NIS, AI, RIB). See the settings table in `docs/domain.md`.
- Prisma client extension that injects and enforces `tenantId` from the request context (AsyncLocalStorage). Add a test proving tenant A cannot read tenant B's data.
- Auth module: register tenant + owner, login, refresh (rotation, reuse of an old refresh token revokes the whole session), logout, list/revoke sessions. Role guard decorator. Passwords hashed with argon2.
- `IdempotencyInterceptor` usable on any POST route via a decorator. Same key + same body → stored response; same key + different body → `409 IDEMPOTENCY_KEY_REUSED`.
- `DocumentNumberingService.next(tx, tenantId, docType)` using `SELECT ... FOR UPDATE`, format `PREFIX-YYYY-000001`, with a concurrency test (20 parallel calls → 20 unique sequential numbers, no gaps).
- `AuditService.log(tx, ...)`.
- Global exception filter returning `{ code, message, details? }`.
- pino logging, `GET /health` checking the DB, Sentry wired but disabled when no DSN.
- Money helpers in `packages/shared/money` using `decimal.js` (add, sub, mul, round2, sum, format `1 234,56 DA`, parse) with unit tests.

### 4. Web foundation (Next.js)
- App Router, Tailwind + shadcn/ui, TanStack Query, i18n messages files (Arabic default, French, English).
- Login page, register-company page, authenticated layout with sidebar (Tableau de bord, Produits, Achats, Ventes, Clients, Versements, Stock, Paramètres) — pages can be empty placeholders.
- API client with automatic token refresh (single in-flight refresh, queued retries).
- Settings page for the company invoice header and tenant settings.

### 5. Seed
- A demo tenant "Grossiste Demo" with an owner account, documented in README.

### Definition of done
- `docker compose up` + `pnpm dev` runs everything locally.
- `pnpm lint && pnpm typecheck && pnpm test` all pass.
- README explains setup in under 10 steps.
- End with a summary of what you built, how to test it manually, and Decisions.

Work in small commits. If something in AGENTS.md is ambiguous, choose the option that protects data correctness and note your choice in the summary.
