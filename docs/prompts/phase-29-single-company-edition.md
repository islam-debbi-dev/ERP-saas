Read AGENTS.md, docs/architecture.md, docs/runbook.md and the phase 13 / 13b code (`apps/api/src/billing`, `apps/api/src/admin`, `apps/api/src/auth` register) before doing anything.

## Task: Phase 29 — Édition mono-société (one company, sold once, on its own VPS)

Branch: `phase-29-single-company-edition`. Phases 1–28 are merged. This is the **last** phase of this plan.

The need: sell the system once to one company, with (almost) every feature, installed on a VPS with its own database. They must not be able to add another company. No yearly maintenance is included: they get the version they bought.

### Design (decided)
- **Same codebase, never a fork.** One env var `DEPLOYMENT_MODE=saas|single` (default `saas`, validated by the config schema). Every difference goes through one helper `isSingle()` and is tested in both modes.
- **In `single` mode:**
  - `POST /auth/register` and `/inscription` are gone (404). The one company and its OWNER are created at install by a CLI `pnpm --filter @erp/api single:init --company "…" --owner-email … --owner-phone …`; it refuses to run if a tenant already exists. The tenants table gets a DB-level guard (trigger) refusing a second row when `app.deployment_mode = 'single'` is set on the database.
  - Super-admin area, plans, trials, subscription payments and suspension are off (routes 404, menu hidden). The tenant has edition ENTREPRISE (every feature) unless the license says otherwise.
  - **License file** `/srv/erp/license.json`: company name, NIF, edition, features, `maxUsers`, `issuedAt`, no expiry, signed with Ed25519. The API embeds the public key and verifies the file at boot; invalid or missing → read-only mode with a clear banner (never data loss). The private key and a `pnpm license:issue` script stay with islam, outside the repo (document where to keep it). Over `maxUsers`: inviting is refused, existing users keep working.
  - WhatsApp (27–28) works the same: the company connects its own number.
- **Delivery on their VPS** (`infra/single/`): a compose file with db (Postgres + WAL-G), api, web, Caddy, and the jobs; images pulled from GHCR with a read-only token tied to that customer (revocable), or a `docker save` tarball for offline install. An `install.sh` that asks for the domain, generates every secret, writes the env file `chmod 600`, starts the stack, runs migrations, `single:init`, and prints the OWNER's first login.
- **Backups are their responsibility but set up on day one**: WAL-G to their own bucket (install asks for it; refuses to finish without one unless `--no-backup` is typed explicitly), restore drill script included, and a one-page French/Arabic handover doc `docs/single-company-handover.md` (where the data is, how to back up and restore, how to rotate secrets, what is not covered).
- **Updates**: none included. Document how a paid update would be applied later (new image tag + `migrate deploy`), so it stays possible.

### Tests
- Unit: license signature valid / tampered / wrong key; `maxUsers`; config defaults to `saas`.
- Integration in `single` mode: register returns 404; `single:init` creates one tenant and refuses a second run; inserting a second tenant directly fails (trigger); admin routes 404; every feature available; invalid license → writes refused, reads allowed.
- Integration in `saas` mode: everything from phases 1–28 unchanged (the full suite runs in both modes in CI, as a matrix).
- `infra/single/install.sh` dry-run in CI (shellcheck + a compose config check).

### Not in this phase
Automatic updates, remote monitoring of the customer's server, white-label branding (parked).

### Definition of done
AGENTS.md §10. Summary ends with What / How to test manually / Decisions / Next phase (none in this plan: back to the ROADMAP backlog).
