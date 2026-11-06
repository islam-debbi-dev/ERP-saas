# Runbook

How to run the platform in production: one VPS running Docker Compose, with Caddy for TLS, Postgres backed up by WAL-G to an S3-compatible bucket, Sentry, an uptime monitor and Better Stack Logs.

The infrastructure files are in `infra/deploy/` (stacks and scripts), `infra/postgres/` (the database image) and `infra/scripts/` (the restore drill).

The rule behind everything here: **losing a client's credit book is not acceptable.** When in doubt, stop writing (put the app in maintenance by stopping `api`) and restore rather than guess.

## Contents
1. [Layout](#layout)
2. [First server setup](#first-server-setup)
3. [Deploy](#deploy)
4. [Rollback](#rollback)
5. [Backups](#backups)
6. [Restore](#restore)
7. [Monthly restore drill](#monthly-restore-drill)
8. [Ledger reconcile](#ledger-reconcile)
9. [Database roles](#database-roles)
10. [Rotate secrets](#rotate-secrets)
11. [Incidents](#incidents)

## Layout

```
VPS (Ubuntu 24.04, 4 vCPU / 8 GB recommended: two stacks + Chromium for PDFs)
├── erp-caddy        Caddy :80/:443, TLS for both hosts
│     staging.<domain>  → erp-staging-web,    /api/* → erp-staging-api
│     app.<domain>      → erp-production-web, /api/* → erp-production-api
├── erp-staging      db (Postgres+WAL-G) · backup · api · web · vector (optional)
└── erp-production   db (Postgres+WAL-G) · backup · api · web · vector (optional)

/srv/erp/
├── deploy/                  infra/deploy, copied by CI on every deploy
│   └── caddy/.env           host names + ACME e-mail (not in git)
├── scripts/                 infra/scripts (restore drill), copied by CI
├── staging.env              secrets of staging (chmod 600, not in git)
├── production.env           secrets of production
└── <env>.current-tag / <env>.previous-tag   written by deploy.sh
```

- The browser talks to one origin per environment. Caddy serves the API under `/api` and strips that prefix. The same web image therefore works on both hosts, there's no CORS, and the refresh cookie (`/api/auth`) stays first-party.
- Postgres is never exposed outside Docker.
- Images live on GHCR: `ghcr.io/islam-debbi-dev/erp-saas/{api,web}:<git sha>` and `…/postgres:16-walg-v3.0.8`.

## First server setup

### Accounts to create
| What | Suggested | Used for | Cost |
|---|---|---|---|
| VPS | Hetzner CX32 (EU), Ubuntu 24.04 | everything | ~€8/month |
| Domain | any registrar | `app.` and `staging.` subdomains | ~€10/year |
| S3 bucket | Backblaze B2 or Cloudflare R2, **in another provider than the VPS** | WAL-G backups | ~€1/month |
| Sentry | free plan; projects `erp-api` and `erp-web` | errors, ledger alerts | free |
| Uptime | UptimeRobot or Better Stack | `/api/health` checks, e-mail/SMS alerts | free |
| Logs (optional) | Better Stack Logs, one source per environment | searchable logs | free tier |

### Steps
1. **DNS**: create `A` records for `app.<domain>` and `staging.<domain>` pointing to the VPS IP.
2. **Server**: as root, copy `infra/deploy/scripts/bootstrap-server.sh` over and run it. It installs Docker and the firewall (SSH, 80, 443 only), creates the `deploy` user and `/srv/erp`, and creates the `erp-edge` network.
3. **SSH for CI**: generate a key pair (`ssh-keygen -t ed25519 -f erp-deploy`) and put the public key in `/home/deploy/.ssh/authorized_keys`.
4. **Bucket**:
   - Create one private bucket, for example `erp-backups`, with server-side encryption on.
   - Create an application key limited to that bucket (read + write + delete).
   - Turn on object lock or versioning if the provider offers it, so a stolen key can't erase the history.
5. **Env files**:
   - Copy `infra/deploy/env.example` to `/srv/erp/staging.env` and `/srv/erp/production.env`, and fill both (`chmod 600`).
   - Every secret must be different between the two files.
   - `WALG_S3_PREFIX` must be different too: `s3://erp-backups/staging` and `s3://erp-backups/production`.
   - **Copy the `WALG_LIBSODIUM_KEY` of production into a password manager.** Without it, the backups can't be decrypted.
6. **Caddy**: copy `infra/deploy/caddy/.env.example` to `/srv/erp/deploy/caddy/.env` and set the host names. The first deploy copies the deploy files, then start Caddy once: `cd /srv/erp/deploy && docker compose -f caddy/compose.yml --env-file caddy/.env up -d`.
7. **GitHub** (repository settings):
   - Variables:
     - `DEPLOY_ENABLED=true`
     - `DEPLOY_SSH_HOST=<VPS IP>`
     - `STAGING_HOST=staging.<domain>`
     - `PRODUCTION_HOST=app.<domain>`
     - optional `WEB_SENTRY_DSN`
   - Secrets:
     - `DEPLOY_SSH_KEY`: the private key
     - `DEPLOY_KNOWN_HOSTS`: the output of `ssh-keyscan <VPS IP>`
   - Environments: create `staging`, and `production` **with yourself as required reviewer**. That required review is the manual approval before production.
8. **First deploy**: merge to main (or run the *Deploy* workflow by hand).
   - On the first start, the database creates `erp_app` with `APP_DB_PASSWORD`, then the migrations run.
   - There's no seed in production images. Create the first company through the web app's registration page, on staging and on production.
9. **Uptime monitor**: HTTP(S) checks on `https://app.<domain>/api/health` and `https://staging.<domain>/api/health`.
   - Every minute
   - Expect status 200 and the keyword `"db":"up"`
   - E-mail + SMS alerts to you
10. **Sentry alerts**: in each project, an alert rule for *every new issue* by e-mail. The nightly ledger reconcile and failed backups also report there, as errors.
11. **Restore drill**: run one right away (see [Monthly restore drill](#monthly-restore-drill)) and record it.

## Deploy

This is automatic: a merge to `main` runs `.github/workflows/deploy.yml`.

1. **CI** runs lint, typecheck, tests (as `erp_app`, under RLS), the build, `pnpm audit`, the destructive-migration check and the backup/restore drill test.
2. **images** builds api, web and postgres and pushes them to GHCR, tagged with the git sha.
3. **staging** copies `infra/deploy` to the server and runs `deploy.sh staging <sha>`, which does:
   - pull
   - database up
   - **`prisma migrate deploy` as the owner**
   - api + web up
   - wait until healthy

   Then a smoke test checks that `https://staging.<domain>/api/health` reports `"version": "<sha>"`.
4. **production** waits for your approval in GitHub (*Review deployments*), then does the same thing.

By hand, on the server as `deploy`:

```bash
/srv/erp/deploy/scripts/deploy.sh production <sha>
```

The migrations run while the old version is still serving. They must stay backward compatible (expand → migrate → contract, AGENTS.md §7), and `pnpm --filter @erp/api db:check-migrations` enforces that in CI.

A migration that drops or renames something must ship in a later release than the code that stopped using it, with `-- destructive-ok: <reason>` on the line above the statement.

## Rollback

```bash
/srv/erp/deploy/scripts/rollback.sh production          # back to the previous tag
/srv/erp/deploy/scripts/rollback.sh production 3f2c1ab  # or a given one
```

- It only swaps the api and web images. The database stays as it is: the older code runs against the newer schema because migrations are expand-only.
- If the images are no longer on the server, log in to GHCR first: `docker login ghcr.io` with a personal token that has `read:packages`.
- A bad migration is fixed with a new migration (forward fix), not by rolling the database back. If data was damaged, see [Restore](#restore).

## Backups

What runs, in each environment's `db` and `backup` containers:

- **Continuous WAL archiving**: Postgres's `archive_command` → `wal-g wal-push`, at least every 60 s (`archive_timeout`). At most about a minute of writes is at risk.
- **Daily base backup** at `BACKUP_AT` (02:00 Algiers) by the `backup` sidecar: `wal-g backup-push`. Then `wal-g delete retain FULL 30` keeps 30 daily backups plus all the WAL in between, which allows **point-in-time recovery to any second of the last 30 days**.
- **Encryption**: WAL-G encrypts every file on the server before upload with libsodium (`WALG_LIBSODIUM_KEY`), and the bucket adds its own server-side encryption.
- **Off the host**: the bucket is with another provider than the VPS.
- **Alerts**: a failed backup or retention run posts to `ALERT_WEBHOOK_URL`. A failing `archive_command` shows in the db logs, and WAL piles up on disk (see [Disk full](#disk-full)).

Check them:

```bash
cd /srv/erp/deploy
docker compose -p erp-production -f compose.yml --env-file ../production.env exec backup wal-g backup-list
docker compose -p erp-production -f compose.yml --env-file ../production.env exec db \
  psql -U erp -d erp -c 'SELECT archived_count, last_archived_wal, last_archived_time, failed_count, last_failed_time FROM pg_stat_archiver'
# Take a base backup now (before a risky operation):
docker compose -p erp-production -f compose.yml --env-file ../production.env exec backup backup-loop.sh --now
```

## Restore

Always restore into a **new** volume first, check it with the drill script, and only then switch over. Never restore over the live data directory.

1. **Find the target.** For "the state at 14:05 before the bad import", the target is `2026-11-03 14:05:00+01`. For "the latest", leave the target out.
2. **Rehearse on a scratch copy** (CI copies `infra/scripts` to `/srv/erp/scripts`):
   ```bash
   /srv/erp/scripts/restore-drill.sh --env-file /srv/erp/production.env \
     --image ghcr.io/islam-debbi-dev/erp-saas/postgres:16-walg-v3.0.8 \
     --target-time '2026-11-03 14:05:00+01'
   ```
   It prints row counts and the ledger check of the restored copy.
3. **Switch over** (production downtime starts here):
   ```bash
   P="docker compose -p erp-production -f /srv/erp/deploy/compose.yml --env-file /srv/erp/production.env"
   $P stop api web backup            # nothing writes any more
   $P exec backup backup-loop.sh --now || true   # last backup of the current state, if the db still runs
   $P stop db
   docker volume create erp-production_db_restore
   # fetch the backup into it and set up recovery (same commands as the drill script):
   docker run --rm --env-file /srv/erp/production.env -e TARGET_TIME='2026-11-03 14:05:00+01' \
     -v erp-production_db_restore:/var/lib/postgresql/data --entrypoint bash \
     ghcr.io/islam-debbi-dev/erp-saas/postgres:16-walg-v3.0.8 -euo pipefail -c '
       D=/var/lib/postgresql/data; wal-g backup-fetch "$D" LATEST
       { echo "restore_command = '\''wal-g wal-fetch %f %p'\''"; echo "recovery_target_action = '\''promote'\''"
         [ -n "$TARGET_TIME" ] && echo "recovery_target_time = '\''$TARGET_TIME'\''"; } >> "$D/postgresql.auto.conf"
       touch "$D/recovery.signal"; chown -R postgres:postgres "$D"; chmod 700 "$D"'
   ```
   - Point the `db_data` volume at the restored one. In `compose.yml`, set `volumes: db_data: { external: true, name: erp-production_db_restore }`, or copy the files into the original volume.
   - Then `$P up -d db`, wait until `psql … -c 'SELECT pg_is_in_recovery()'` says `f`, and run the reconcile (below).
   - Then `$P up -d`.
   - The restored server starts a new timeline, and WAL-G keeps archiving it next to the old one.
4. **Keep the old volume** until a week after the restore.
5. **Write down** what happened, the target time and the data lost between the target and the incident. Tell the affected grossistes what to re-enter.

## Monthly restore drill

**The first Monday of every month, for production.** It takes about 10 minutes.

```bash
mkdir -p /srv/erp/drills
/srv/erp/scripts/restore-drill.sh --env-file /srv/erp/production.env \
  --image ghcr.io/islam-debbi-dev/erp-saas/postgres:16-walg-v3.0.8 \
  --report /srv/erp/drills/$(date +%F).txt
```

- It restores the latest base backup plus all archived WAL into a throwaway container, with no network port and no archiving, so the live database and the bucket are untouched.
- It prints the row counts and `latest_audit_at`. That should be within a minute or two of now.
- It checks that cached stock and client balances equal their ledgers.
- It exits non-zero if anything fails.
- Once a quarter, also run it with `--target-time` set to some time yesterday, to prove point-in-time recovery.

Record each drill in the log below: the date, who ran it, the result, the duration and `latest_audit_at`. A drill that fails is an incident: fix it before the next deploy.

CI runs the same script on every pull request, against a scratch S3 bucket (`infra/ci/backup-drill-test.sh`). That proves the scripts work, but not that the production bucket and keys do; only the monthly drill proves that.

| Date | Environment | By | Result | Duration | latest_audit_at |
|---|---|---|---|---|---|
| 2026-10-22 | local rehearsal of staging (`infra/deploy` on Docker, local S3) | Claude Code | OK: 1 tenant, 2 products, 1 sale, 1 payment, 0 ledger mismatches. The versement written 9 s after the last base backup came back from the WAL archive | 7 s | 2026-10-21 23:09:40 UTC |

## Ledger reconcile

Every night at 03:00 Algiers, the API checks every tenant:
- the cached stock (`product_stocks`) equals the sum of `stock_movements`
- each movement's `balanceAfter` chain is consistent
- each client balance (`client_balances`) equals the sum of `client_ledger_entries`
- each employee's avance and congé balances (`employee_balances`) equal `employee_ledger_entries` and `leave_entries`
- each cached day (`attendance_days`) equals what its events, leaves and calendar give, outside locked months
- each supplier balance (`supplier_balances`) equals the sum of `supplier_ledger_entries` (phase 21)
- no cache row is missing

A difference **is never fixed automatically**. It is:
- logged at error level
- sent to Sentry as "Ledger reconcile: N difference(s)", with the list
- written to the tenant's audit log as `LEDGER_MISMATCH` (cached value vs ledger value)

Run it by hand (exit code 1 when something differs):

```bash
docker compose -p erp-production -f /srv/erp/deploy/compose.yml --env-file /srv/erp/production.env \
  exec api node dist/reconcile/reconcile.cli.js
```

When it reports something:
1. Don't touch the ledger. Ledger rows are the truth and are append-only.
2. Find when it diverged: the audit log of that product or client (Paramètres → Journal d'audit, filtered by object), and the movements around it.
3. A wrong **cache** (the ledger is right, the cached value isn't) comes from a bug. Fix the bug first. Then recompute the cache from the ledger in one transaction, as the owner, with a note in the audit log.
4. A wrong **ledger** (a movement that shouldn't exist, or a missing one) is fixed by a reversing or correcting entry through the app (adjustment, avoir, annulation), never by an UPDATE.

### Supplier ledger backfill (once, after the phase 21 deploy)

Bons de réception validated before phase 21 have no supplier ledger entries. After deploying phase 21 on an environment, run the backfill once (it is safe with the app running and safe to run again: a BR or retour that already has an entry is skipped):

```bash
docker compose -p erp-production -f /srv/erp/deploy/compose.yml --env-file /srv/erp/production.env \
  exec api node dist/purchases/supplier-backfill.cli.js
```

It posts, dated at the original validation, the BR's TTC, minus what was paid at reception, minus its retours. Cancelled BRs post nothing. Then run the reconcile above: it must report no supplier difference.

### Treasury backfill (once, after the phase 34 deploy, **staging first**)

After `db:deploy`, run it **twice**, then the reconcile. It is safe with the app running: the second run must report `0 rows linked, 0 movements written`, unless the version being replaced wrote rows in between.

```bash
docker compose -p erp-production -f /srv/erp/deploy/compose.yml --env-file /srv/erp/production.env \
  exec api node dist/treasury/treasury-backfill.cli.js
```

It links every versement, règlement and dépense without an account to the default account, and writes the movements of the valid ones, dated at the row's date. A row already cancelled or bounced gets its account and no movement. It prints the BRs paid at reception it cannot turn into règlements (count, total): tell the owner, whose opening balance has to be the real figure of that day. Balances mean nothing until each account has its solde initial.

`cashAccountId` stays nullable until a later contract release.

### Warehouse backfill (once, after the phase 15 deploy, **staging first**)

Rows written before phase 15 have no dépôt. The app already treats them as the main dépôt (the first stock write of a product creates its main-dépôt row from `ProductStock`), so nothing is wrong in the meantime; the backfill makes it explicit before the contract release turns the columns `NOT NULL`.

Per tenant, in one transaction, it locks the tenant's stock rows, creates the main dépôt, sets it on every movement, validated or cancelled sale and BR, retour and inventaire that has none (drafts keep none: their dépôt is chosen at validation), creates the main dépôt's stock rows from `ProductStock`, then checks: the split sums to `ProductStock`, each dépôt equals its ledger, no movement is left without a dépôt, and the company stock total did not move. **Any mismatch rolls that tenant back and stops the run** (exit code 1, the tenant and product ids in the log). Safe with the app running, safe to run twice.

1. On **staging** (restore last night's production backup there first, see Restore):
   ```bash
   docker compose -p erp-staging -f /srv/erp/deploy/compose.yml --env-file /srv/erp/staging.env \
     exec api node dist/reconcile/reconcile.cli.js            # must be clean before
   docker compose -p erp-staging -f /srv/erp/deploy/compose.yml --env-file /srv/erp/staging.env \
     exec api node dist/stock/warehouse-backfill.cli.js       # "Company stock before X, after X"
   docker compose -p erp-staging -f /srv/erp/deploy/compose.yml --env-file /srv/erp/staging.env \
     exec api node dist/stock/warehouse-backfill.cli.js       # second run: 0 rows filled, 0 created
   docker compose -p erp-staging -f /srv/erp/deploy/compose.yml --env-file /srv/erp/staging.env \
     exec api node dist/reconcile/reconcile.cli.js            # must still be clean
   ```
   Also compare the stock value on the dashboard of two pilot tenants before and after: it must not change.
2. Only then the same three commands on **production** (`-p erp-production`, `production.env`).
3. A mismatch means the tenant's `ProductStock` already disagreed with its ledger (the reconcile would have said so): fix that first (see "A grossiste says a balance is wrong"), then run the backfill again.

**Contract release (later, not with phase 15):** once the backfill has run cleanly in production, move `apps/api/prisma/contract/phase-15-warehouses-contract.sql` into a new migration folder. It makes the dépôt required (`NOT NULL` on movements, retours and inventaires; a `CHECK` on sales and BRs, whose drafts may still have none) and puts back the strict append-only trigger on `stock_movements`. Its first statement fails if any row was missed, so it can't be applied before the backfill.

### Units backfill (once, after the phase 24 deploy, **staging first**)

Phase 24 records the dépôt of every versement and client ledger entry. Rows written before it have none. The deploy migration already gives every user "Travailler" on every existing dépôt and puts every truck under the dépôt principal, so nobody loses access in the meantime, and the app counts a row without a dépôt as the dépôt principal's. The backfill makes it explicit before the contract release turns the columns `NOT NULL`.

Per tenant, in one transaction, with the client balances locked in client order (safe with the app running), it:
- gives each versement the dépôt of the sale it was taken with, else of the oldest sale it pays, else the dépôt principal;
- gives each ledger entry the dépôt of its document (sale, avoir, versement), else the dépôt principal;
- gives any user still without it "Travailler" on every dépôt, and a parent to any truck without one.

It then checks that no row is left without a dépôt, that every client balance still equals its ledger, and that the sum of the balances did not move. **Any mismatch rolls that tenant back and stops the run** (exit code 1, the tenant and client ids in the log). Safe to run twice: the second run fills and creates nothing.

1. On **staging** (restore last night's production backup there first, see Restore):
   ```bash
   docker compose -p erp-staging -f /srv/erp/deploy/compose.yml --env-file /srv/erp/staging.env \
     exec api node dist/reconcile/reconcile.cli.js            # must be clean before
   docker compose -p erp-staging -f /srv/erp/deploy/compose.yml --env-file /srv/erp/staging.env \
     exec api node dist/stock/unit-backfill.cli.js            # "Client balances before X, after X"
   docker compose -p erp-staging -f /srv/erp/deploy/compose.yml --env-file /srv/erp/staging.env \
     exec api node dist/stock/unit-backfill.cli.js            # second run: all counts 0
   docker compose -p erp-staging -f /srv/erp/deploy/compose.yml --env-file /srv/erp/staging.env \
     exec api node dist/reconcile/reconcile.cli.js            # must still be clean
   ```
2. Only then the same commands on **production** (`-p erp-production`, `production.env`).
3. A mismatch means a client's cached balance already disagreed with its ledger (the reconcile would have said so): fix that first, then run the backfill again.

**Contract release (later, not with phase 24):** once the backfill ran cleanly in production, move `apps/api/prisma/contract/phase-24-units-contract.sql` into a new migration folder and make `warehouseId` required on `Payment` and `ClientLedgerEntry` in `schema.prisma`. It also requires a parent dépôt on every live truck and puts back the strict append-only trigger on `client_ledger_entries`. Its first statement fails if any row was missed.

## Database roles

| Role | Used by | RLS |
|---|---|---|
| `erp` (owner) | migrations, seed, backups, restore drill, manual SQL | bypasses it, because it owns the tables |
| `erp_app` | the API (`DATABASE_URL`) | **bound by it** |

- Every tenant table has a row-level security policy. A row is visible only when its `tenantId` equals `app.tenant_id`, which the API's pool sets on every connection from the request's tenant. The system context (login, register, the nightly reconcile) sets `app.rls_bypass=on`.
- A connection as `erp_app` without these settings sees nothing and can't write.
- The role is created on the database's first start (`infra/postgres/init/10-app-role.sh`), and migrations grant it access to the tables.
- For a database that existed before (dev, or a restored old backup):
  ```bash
  psql "$OWNER_URL" -c "CREATE ROLE erp_app LOGIN PASSWORD '<APP_DB_PASSWORD>'"
  psql "$OWNER_URL" -f apps/api/prisma/app-role.sql
  ```

## Rotate secrets

Rotate a secret right away if it may have leaked (a laptop was lost, a key was pasted into a chat, someone left), and otherwise once a year.

| Secret | How | Effect |
|---|---|---|
| `JWT_ACCESS_SECRET` | new value in `<env>.env`, then `deploy.sh <env> $(cat /srv/erp/<env>.current-tag)` | access tokens die. Clients refresh silently: refresh tokens are in the database, not signed with it |
| Sessions of a user | Paramètres → Sessions, or deactivate the user | immediate |
| All sessions (suspected breach) | `UPDATE sessions SET "revokedAt" = now(), "revokedReason" = 'REVOKED' WHERE "revokedAt" IS NULL;` as the owner | everyone logs in again (the API checks the session on every request) |
| `APP_DB_PASSWORD` | `ALTER ROLE erp_app PASSWORD '<new>'` as the owner, update `<env>.env`, redeploy | API reconnects |
| `POSTGRES_PASSWORD` | `ALTER ROLE erp PASSWORD '<new>'`, update `<env>.env`, `up -d backup` and redeploy | migrate and backup use the new one |
| Bucket keys | create a new key, update `<env>.env`, `up -d db backup` (db restarts: ~10 s), then delete the old key | archiving continues |
| `WALG_LIBSODIUM_KEY` | **don't rotate in place**: old backups need the old key. Set the new key, take a base backup at once (`backup-loop.sh --now`), keep the old key in the password manager for 30 days (the retention), then drop it | |
| Deploy SSH key | new key pair, replace `authorized_keys` and the `DEPLOY_SSH_KEY` secret | |
| Sentry DSN | rotate in Sentry, update `SENTRY_DSN` / `WEB_SENTRY_DSN`, redeploy | |

## Incidents

### The site is down (uptime alert)
1. `curl -s https://app.<domain>/api/health`:
   - `502` from Caddy means the api is down
   - `{"code":"DB_UNAVAILABLE"}` means the database is down
2. `docker compose -p erp-production … ps` and `… logs --tail 200 api`.
3. If the api is crash-looping after a deploy, [roll back](#rollback).

### The database is down
1. `… ps db` and `… logs --tail 200 db`.
2. If it stopped, run `… up -d db`. Postgres replays its own WAL on start; wait for "ready to accept connections".
3. If it won't start (corrupt files, disk lost), don't delete anything. [Restore](#restore) into a new volume to the latest point, then switch over.
4. The api answers 503 `DB_UNAVAILABLE` while the database is down and recovers on its own when it's back.

### Disk full
1. `df -h` and `docker system df`.
2. A failing `archive_command` (bucket down, or a wrong key) makes `pg_wal` grow:
   - check `pg_stat_archiver.failed_count` and the db logs
   - fix the bucket or keys; Postgres catches up on its own
   - never delete files in `pg_wal` by hand
3. Clean up old images: `docker image prune -a --filter until=720h`. The current and previous tags are still in use, so they stay.
4. Logs rotate on their own (20 MB × 5 per container).

### A grossiste says a balance is wrong
1. Run the reconcile by hand for evidence.
2. Look at the client's statement (relevé) and the audit log.
3. A balance is never edited. A correction goes through an adjustment or avoir entry, with a reason that names the ticket.
