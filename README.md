# ERP-saas

Gestion commerciale SaaS for Algerian grossistes: products & stock, purchases, sales (BL, facture, avoir), client credit and versements, dashboards.

- Rules for AI agents and contributors: [AGENTS.md](AGENTS.md)
- Plan: [docs/ROADMAP.md](docs/ROADMAP.md) · Phase prompts: [docs/prompts/](docs/prompts/)
- How to run the phases in Claude Code: [docs/HOW-TO-RUN-WITH-CLAUDE-CODE.md](docs/HOW-TO-RUN-WITH-CLAUDE-CODE.md)
- Business rules: [docs/domain.md](docs/domain.md) · Architecture: [docs/architecture.md](docs/architecture.md)

## Setup

Requirements: Node 22+ (24 or 26 also work), Docker (Docker Desktop or OrbStack).

1. Enable pnpm: `corepack enable` (or `corepack install -g pnpm@11`).
2. Install dependencies: `pnpm install`.
3. Copy the env files: `cp apps/api/.env.example apps/api/.env` and `cp apps/web/.env.example apps/web/.env.local`.
4. Start Postgres (dev on 5432, tests on 5433): `docker compose -f infra/docker-compose.yml up -d db db_test`.
5. Create the tables: `pnpm db:migrate`.
6. Create the demo company: `pnpm db:seed`.
7. Start the API (http://localhost:3001) and the web app (http://localhost:3000): `pnpm dev`.
8. Open http://localhost:3000 and log in with the demo account below.

### Demo account

| Company | E-mail | Password | Role |
|---|---|---|---|
| Grossiste Demo | `demo@grossiste.dz` | `Demo1234!` | OWNER |

Change the password with `SEED_OWNER_PASSWORD` in `apps/api/.env` before seeding a shared environment. Running the seed again changes nothing.

### Database roles (row-level security)

Every business table has a Postgres row-level security policy on top of the Prisma tenant filter. The policies bind `erp_app`, the role the API connects as (`DATABASE_URL`). They don't bind the owner `erp`, which runs migrations and the seed (`DATABASE_URL_MIGRATE`). The dev database creates `erp_app` on its first start.

A dev database created before phase 12 doesn't have the role. Create it once, then re-apply the grants:

```bash
docker compose -f infra/docker-compose.yml exec db psql -U erp -d erp -c "CREATE ROLE erp_app LOGIN PASSWORD 'erp_app'"
docker compose -f infra/docker-compose.yml exec -T db psql -U erp -d erp < apps/api/prisma/app-role.sql
```

The integration tests create the role on their own and run the whole suite as `erp_app`.

## Production

Staging and production run on one VPS with Docker Compose and Caddy, with Postgres backed up by WAL-G to an S3 bucket. See [`docs/runbook.md`](docs/runbook.md) for first server setup, deploy, rollback, backups, restore, the monthly restore drill and incidents.

### Vercel (demo)

The API and the web app can also run as two Vercel projects (root directories `apps/api` and `apps/web`) on a Neon Postgres. The web project proxies `/api/*` to the API through [`apps/web/vercel.json`](apps/web/vercel.json), so the refresh cookie stays first-party: set `NEXT_PUBLIC_API_URL=/api` on the web project, and `PUBLIC_PATH_PREFIX=/api`, `COOKIE_SECURE=true` and `WEB_ORIGIN` on the API. `DATABASE_URL` must be Neon's direct (non `-pooler`) string, because the RLS settings are session-level. The API functions run in `fra1` (Frankfurt, [`apps/api/vercel.json`](apps/api/vercel.json)), next to the Neon database (AWS eu-central-1): every operation makes several queries, and from another region a sale took 5–10 s to validate and hit the transaction time limit. Keep the two in the same region. Vercel functions have no Chromium, so PDFs there use [`@sparticuz/chromium`](https://github.com/Sparticuz/chromium) (picked when `VERCEL=1`, which Vercel sets): the first print of a new instance takes a few seconds while it unpacks to `/tmp`. Its only font is Open Sans; `apps/api/assets/fonts/NotoNaskhArabic.ttf` (SIL Open Font License) is added for Arabic names.

## Subscriptions and super-admin (phase 13)

New companies get a **30-day trial** on the Pro plan. After the period end they are `PAST_DUE` for 7 days (banner, everything still works), then `SUSPENDED`: read-only, they can still view, print and export, but every write answers `SUBSCRIPTION_SUSPENDED`. The status is computed from the dates on each request; there is no scheduled job. Plans and prices (Starter 2 500 DA, Pro 4 500 DA, Business 8 000 DA per month) are rows of the `plans` table, inserted by the migration and the seed; change a price there. Companies that existed before phase 13 are **free (pilot)**.

### Editions and modules (phase 13b)

A subscription has two parts: the **plan** (Starter / Pro / Business) sets the price and the limits, the **edition** (Essentiel / Import / Distribution / Entreprise) sets the modules on top of the core (`packages/shared/src/features.ts`). Price = plan price + the edition's supplement, a row of the `edition_prices` table: Essentiel 0, Import 1 500, Distribution 2 500, Entreprise 4 000 DA per month. Change a supplement in that table. Signup asks the company's activity and starts the trial on the matching edition; pilots are on Entreprise.

From the super-admin tenant page you change the edition and switch single modules on or off for one company (stored as `featureGrants` / `featureRevokes` on the tenant, audited). A module's routes carry `@RequireFeature(Feature.X)` and answer `403 FEATURE_NOT_IN_PLAN` when the company does not have it; its reports and exports stay readable and its data is never deleted. The API reads the modules on each request through a 60-second cache, so a change applies without a new login: at once on the instance that handled it, within 60 s on the others.

Payments are recorded by hand by the super-admin at `/admin` (BaridiMob, virement, espèces), which extends the period. The super-admin is not a company user: create one, once, with the owner database connection (`DATABASE_URL_MIGRATE`, or `DATABASE_URL` locally):

```bash
pnpm --filter @erp/api admin:create --email you@example.com --name "Your name"
pnpm --filter @erp/api admin:create --email you@example.com --reset   # new password + code, closes its sessions
```

It prints a password (shown once) and a TOTP secret with an `otpauth://` link: add it to an authenticator app (Google Authenticator, Aegis…). Login at `/admin/login` asks for both. "View read-only" on a company opens it in a new tab for 30 minutes; every write is refused, each request is logged in `platform_audit_logs`, and the company sees the visit in its own journal.

Sidebar help links come from the web env (`NEXT_PUBLIC_SUPPORT_WHATSAPP`, `NEXT_PUBLIC_TUTORIAL_*_URL`, see `apps/web/.env.example`); a link stays hidden while its variable is empty.

## Everyday commands

```bash
pnpm lint && pnpm typecheck && pnpm test   # before every commit
pnpm build
pnpm --filter @erp/api test:unit           # API unit tests only
pnpm --filter @erp/api test:int            # API integration tests (needs db_test)
pnpm --filter @erp/api db:studio           # browse the dev database
```

Integration tests reset the **test** database (`DATABASE_URL_TEST`, port 5433) at the start of each run. They never touch the dev database.

`docker compose -f infra/docker-compose.yml up --build` also builds and runs the API and web containers.

## Printing (PDF)

Documents (BL, facture, avoir, bon de réception, relevé de compte, reçu de versement) are rendered **on the server** as A4 or A5 PDFs by headless Chromium (puppeteer), so a print looks the same on every machine.

- `pnpm install` downloads the headless browser into `~/.cache/puppeteer` (allowed in `pnpm-workspace.yaml`). To use another Chromium, set `CHROMIUM_PATH` in `apps/api/.env`.
- On Linux without Chromium's system libraries, install them once: `npx puppeteer browsers install chrome-headless-shell --install-deps` (from `apps/api`).
- The Docker image installs Alpine's `chromium` and fonts and sets `CHROMIUM_PATH`.
- Settings → Documents: default format, footer text, "Non assujetti à la TVA" mention, timbre rule.

### Timbre fiscal

The timbre is a **tenant rule**, off by default: threshold, tranches (rate in % per amount band; the whole TTC is taxed at the rate of its band), minimum and maximum. It applies only to a facture paid in cash (espèces), is added to what the client owes and printed on the facture.

The values put in the demo seed (300 DA threshold, 1 % / 1.5 % / 2 % tranches, 5 DA minimum, 10 000 DA maximum) are **examples only**. Before enabling the rule for a real grossiste, verify every value against the **current loi de finances** and enter them in Settings → Documents.

## Repo layout

```
apps/api         NestJS API (Prisma, auth, tenancy, numbering, idempotency, audit)
apps/web         Next.js web app (French UI)
packages/shared  zod schemas, enums, error codes, money helpers shared by api and web
infra/           docker-compose
```
