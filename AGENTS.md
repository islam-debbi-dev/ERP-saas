# AGENTS.md

Rules for any AI coding agent (Claude Code, Codex, Cursor...) working in this repo.
Read this file fully before doing anything. When a rule here conflicts with a prompt, this file wins unless the prompt explicitly says it overrides a named rule.

## 1. What we are building

A multi-tenant SaaS for Algerian **grossistes** (wholesalers): products & stock, purchases, sales (bon de livraison, facture, avoir), client credit and versements, dashboards.
Users are traders who type fast, work on credit, and will drop the software forever if one balance is wrong.

- Domain rules: [`docs/domain.md`](docs/domain.md). Read it whenever a task touches products, prices, stock, credit, documents or taxes.
- Architecture: [`docs/architecture.md`](docs/architecture.md). Read it whenever you write backend code, schema or infra.
- Plan: [`docs/ROADMAP.md`](docs/ROADMAP.md). Each phase has a prompt in [`docs/prompts/`](docs/prompts/).

## 2. Stack (decided, do not reopen)

| Layer | Choice |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| API | NestJS 10+ (modular monolith), TypeScript strict |
| DB | PostgreSQL 16 + Prisma |
| Web | Next.js (App Router), Tailwind, shadcn/ui, TanStack Query, TanStack Table, react-hook-form + zod |
| Shared | `packages/shared`: zod schemas, enums, types used by api and web |
| Tests | Jest (api unit + integration against a real Postgres test DB), Vitest or Jest for web/shared |
| Logs / errors | pino, Sentry (disabled when no DSN) |
| Mobile / desktop (later) | Flutter, Clean Architecture + BLoC/Cubit + go_router |

Do not add a new dependency when an existing one does the job. Any new runtime dependency must be named in the commit message with a one-line reason.

## 3. Non-negotiable rules (money and stock)

1. **Ledger, not mutable balances.** Every stock movement and every client/supplier account movement is an immutable row. Balances are derived, or cached in the same transaction and reconcilable from the ledger. Never `UPDATE` a ledger row.
2. **No hard deletes on business data.** Fix mistakes with reversing entries (annulation, avoir, retour). Soft delete (`deletedAt`) only for master data (products, clients, suppliers, users).
3. **One DB transaction per business operation.** A sale = document + lines + stock movements + client ledger entry + audit log + document number, all or nothing.
4. **Money is never a float.** Use Prisma `Decimal(14,2)` in the DB and `decimal.js` in code via `packages/shared/money`. Quantities are `Decimal(14,3)` in the product's base unit. No `Number()` on money, no `+` on money.
5. **`tenantId` on every business table**, taken from the JWT, never from the request body. Enforced in one place: the Prisma tenant extension. Composite indexes start with `tenantId`.
6. **Idempotency keys** (`Idempotency-Key` header) on every POST that creates money or stock effects (sale, versement, purchase, avoir, adjustment). A replay returns the original response.
7. **Audit log** for every write on business data: who, what, when, which device, before/after where useful.
8. **Document numbers**: sequential per tenant, per document type, per year, generated inside the transaction with `SELECT ... FOR UPDATE`. Format `PREFIX-YYYY-000001`. No gaps from failed requests.
9. **Frozen history.** A sale line stores its price, unit, tax rate and designation at sale time. Changing a product never changes a past document.
10. **Concurrency.** Lock affected stock rows with `SELECT ... FOR UPDATE` in a consistent order (by `productId`) to avoid deadlocks. Prefer explicit row locks over `Serializable`.

When a request is ambiguous, choose the option that protects data correctness, and write the choice in the PR summary under "Decisions".

## 4. Code conventions

- TypeScript `strict: true` everywhere. No `any` unless commented with why.
- Code, identifiers, comments and commit messages in **English**. UI text in **French** through the i18n messages file (never hard-coded strings in components). Business terms keep their French names in code where clearer (`versement`, `bonLivraison`, `avoir`) and are explained once in `docs/domain.md`.
- NestJS: thin controllers, logic in services, DB access only through Prisma inside services. Modules talk through exported services, never by querying another module's tables.
- Every input validated (zod schema from `packages/shared` through a `ZodValidationPipe`, or class-validator DTO; pick zod for anything the web also uses).
- Errors: throw `AppException(code, message, details?)`; the global filter returns `{ code, message, details? }`. Error codes are `SCREAMING_SNAKE_CASE` and listed in `packages/shared/errors.ts`.
- Dates stored in UTC; displayed in `Africa/Algiers`. Amounts displayed as `1 234 567,89 DA`.
- Pagination: cursor-based for lists that grow (ledgers, documents, movements); `?cursor=&limit=` with `limit <= 100`.
- No business logic in the web app that the API does not also enforce. The web may compute totals for display; the API recomputes and is the source of truth.

## 5. Tests (required for every phase)

- Unit tests for every calculation: totals, taxes, unit conversion, CUMP, ledger balance, amount in words.
- Integration tests against a real Postgres test DB (not mocks) for every money or stock path:
  - the happy path changes stock / ledger / numbering correctly,
  - an idempotent replay returns the same result and creates nothing new,
  - concurrent operations (e.g. two sales of the last unit) behave as the tenant setting says,
  - tenant A cannot read or write tenant B's rows.
- Never skip, disable or weaken a test to get green.

## 6. Commands

```bash
pnpm install
docker compose -f infra/docker-compose.yml up -d db db_test
pnpm db:migrate        # prisma migrate dev
pnpm db:seed           # demo tenant "Grossiste Demo"
pnpm dev               # api + web
pnpm lint && pnpm typecheck && pnpm test
pnpm build
```

Run `pnpm lint && pnpm typecheck && pnpm test` before every commit that touches code. Do not finish a task with any of them red.

## 7. Database & migrations

- Every schema change is a Prisma migration committed with the code that uses it. Never edit an applied migration.
- Migrations must be backward compatible with the currently deployed version (expand, migrate data, contract in a later release). Renames and drops happen in two steps.
- Seed data lives in `apps/api/prisma/seed.ts` and must stay idempotent (safe to run twice).

## 8. Git workflow

- One branch per phase: `phase-NN-short-name`. Small commits, each one building and passing tests.
- Commit format: `type(scope): summary` (`feat(sales): create bon de livraison`), types `feat|fix|refactor|test|docs|chore|ci`.
- Never commit secrets. `.env` is git-ignored; keep `.env.example` up to date.
- End each phase with a PR whose description has: What was built, How to test manually, Decisions, Next phase.

## 9. Scope guard

The MVP is defined in `docs/ROADMAP.md`. If a task drifts into something not in the current phase, stop and list it under "Parked ideas" in the PR summary instead of building it. Speed to a real pilot grossiste beats completeness.

## 10. Definition of done (every phase)

- [ ] Everything in the phase prompt is built, or explicitly listed as not done with the reason.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass locally and in CI.
- [ ] New env vars are in `.env.example`; new setup steps are in `README.md`.
- [ ] Money/stock paths have integration tests (happy path, idempotency, concurrency, tenant isolation).
- [ ] UI strings are in the French messages file.
- [ ] The phase summary is written (What / How to test / Decisions / Next phase).
