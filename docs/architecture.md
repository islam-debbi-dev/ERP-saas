# Architecture & code conventions

## Repo layout (pnpm workspaces + Turborepo)
```
apps/
  api/        NestJS
  web/        Next.js
  mobile/     Flutter (later)
packages/
  shared/     zod schemas, types, enums shared by api + web
infra/        docker-compose, deploy scripts
```

## NestJS modules (modular monolith)
`auth`, `tenants`, `users`, `products`, `stock`, `purchases`, `sales`, `clients`, `payments` (versements), `documents` (numbering + PDF), `imports` (Excel), `reports`, `audit`.
- Modules talk through services, never by reading each other's tables directly.
- Controllers thin; business logic in services; DB access through Prisma inside services or repositories.
- Validate every input with zod schemas from `packages/shared` through a `ZodValidationPipe` (class-validator only for API-only DTOs).

## Core tables (starting point)
- `tenants`, `users` (role: OWNER, MANAGER, SELLER, STOREKEEPER), `audit_logs`
- `products`, `product_units` (unit, factor_to_base, barcode), `price_levels`, `product_prices`
- `stock_movements` (tenant_id, product_id, qty_base, type: PURCHASE/SALE/RETURN/ADJUST/OPENING, ref_type, ref_id, unit_cost, created_by, created_at) – **append-only**
- `product_stock` (cached current qty, updated in the same transaction; reconcilable from movements)
- `clients` (price_level_id, credit_limit, ...)
- `client_ledger` (tenant_id, client_id, amount signed, type: SALE/PAYMENT/RETURN/OPENING/ADJUST/REVERSAL, ref_type, ref_id, created_at) – **append-only**
- `sales`, `sale_lines` (frozen price, unit, qty, qty_base, tax_rate)
- `payments` (versements: mode, amount, reference, client_id, idempotency_key)
- `purchases`, `purchase_lines`, `suppliers`
- `document_sequences` (tenant_id, doc_type, year, last_number) – increment with `SELECT ... FOR UPDATE` inside the transaction
- `idempotency_keys` (tenant_id, key, endpoint, response_hash, created_at)

## Money & quantities
- Money: **`Decimal(14,2)`** in Postgres, `Prisma.Decimal` / `decimal.js` in code, through helpers in `packages/shared/money` (decided; do not use centimes integers or floats). Round half-up to 2 decimals only when a value is stored or displayed, never in the middle of a calculation.
- Quantities: `Decimal(14,3)` in base unit.

## Concurrency
- Sales: inside `prisma.$transaction`, lock the affected `product_stock` rows (`SELECT ... FOR UPDATE` via `$queryRaw`) in a consistent order (by product_id) to avoid deadlocks.
- Use `Serializable` isolation only where needed; prefer explicit row locks.

## Multi-tenancy
- `tenant_id` from the JWT, never from the request body.
- A Prisma client extension injects `where: { tenantId }` on reads and sets it on writes.
- Add composite indexes starting with `tenant_id`.
- Later: Postgres RLS with `SET app.tenant_id` per transaction as defense in depth.

## Auth
- Access token (short) + refresh token (rotating, stored hashed). Device sessions list so the owner can revoke a lost phone.
- Role guards in NestJS; permissions checked in services for sensitive actions (price override, credit over plafond, cancel sale).

## Web (Next.js)
- App Router, TanStack Query for server state, react-hook-form + zod (shared schemas), a table lib (TanStack Table) for big lists.
- Keyboard-first sale screen (grossistes type fast): barcode input, Enter to add, shortcuts for payment.
- PDF: generate server-side (e.g. headless Chromium or a PDF lib) so prints are identical everywhere.

## Offline (later, Flutter desktop caisse)
- Local SQLite (drift), operations queue with client-generated UUIDs + idempotency keys, server is source of truth for stock; conflicts resolved by accepting sales and flagging negative stock.

## Infra
- Docker images for api and web; GitHub Actions: lint → test → build → migrate staging → deploy staging → manual promote to prod.
- Managed Postgres with daily backups + PITR; monthly restore drill.
- Sentry (api + web), uptime monitor on `/health`, structured logs (pino).
- Prisma migrations must be backward compatible with the currently running version.

## Testing
- Unit: price/tax/total calculations, unit conversions, ledger balance.
- Integration (testcontainers Postgres): create sale → stock decreases, ledger increases, numbering sequential, idempotent replay returns same result, concurrent sales of last unit → one fails.
