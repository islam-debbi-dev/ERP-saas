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
