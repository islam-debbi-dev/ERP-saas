# Field demo seed (`db:seed:field`)

Fills the **production** company *demo-volume* with field data, so every role of the Debvora app and
the maps have something to show. Script: `apps/api/prisma/seed-field.ts` (helpers in
`apps/api/scripts/seed-field/`).

It goes **through the API only**, never SQL and never `DATABASE_URL`: every money and stock row is
written by the real services (ledger, numbering, caisse, audit, GeoCheck). It logs in as the OWNER of
`demo-volume@grossiste.dz`, and as each new vendeur for what only a seller can produce (GPS-checked
sales, versements collected by him, visits, location requests). Those logins are web logins (no
`X-Client-Type`), so they take **no mobile seat**.

## Run

```bash
cd "/Users/islamdebbi/coding/ERP saas/ERP-saas" && pnpm install
read -s "SEED_OWNER_PASSWORD?Password demo-volume: "; export SEED_OWNER_PASSWORD; echo
read -s "SEED_USERS_PASSWORD?Password des nouveaux users: "; export SEED_USERS_PASSWORD; echo
pnpm --filter @erp/api db:seed:field -- --dry-run   # reads, writes nothing, prints what it WOULD create
pnpm --filter @erp/api db:seed:field                # the real run
pnpm --filter @erp/api db:seed:field -- --today     # each morning: only today's part
```

Env (nothing else, never printed): `API_URL` (default `https://erp-saas-pi.vercel.app`), `SEED_EMAIL`
(default `demo-volume@grossiste.dz`), `SEED_OWNER_PASSWORD`, `SEED_USERS_PASSWORD` (the password of the
users it creates). The names are in `apps/api/.env.example`, empty.

## Safety

- **Tenant guard**: before any write it reads `/auth/me` and refuses unless the email is `SEED_EMAIL`, the
  role is OWNER and the company name matches `/demo.*volume/i` (the message prints the name it saw).
- **Preflight**: it stops, telling you to fix it in the super-admin, if MOBILE_APP, TOURNEES, GEO_CHECK,
  INCENTIVES, WAREHOUSES, SALES_FORCE or PROMOTIONS is off (the DISTRIBUTION edition has them),
  `maxMobileSellers` < 4, `maxUsers` too small for the 9 users, `geoCheckMode` is not FLAG or
  `creditLimitMode` is BLOCK.
- **Idempotent and resumable**: a fixed `Idempotency-Key` per step and a check by code / email / name /
  number before each create. A second run creates nothing; a run cut halfway continues. Calls are
  spaced by 300 ms and retried with backoff on 429 / 5xx / timeouts (Vercel cold starts). A step that
  fails is logged, skipped, and the exit code is 2: run again to complete it.
- Money is always a string (`"1250.00"`).

## What it creates

| Part | Content |
|---|---|
| Users | 2 superviseurs (A, B), 4 vendeurs (2 per team), 2 livreurs (1 per team), 1 magasinier, with `managerId` |
| Trucks | VAN-1..4 (one per vendeur, today's driver) and LIV-1..2 (one per livreur) |
| Clients | 150 `FLD-001..150` in 6 towns of the wilaya (M'Sila, Bou Saâda, Sidi Aïssa, Aïn El Melh, Magra, Berhoum), fixed-seed GPS points, 10 % without a point, 4 per vendeur's patch, ~37 with debt, 8 over their plafond |
| Products | existing ones reused; up to 30 `FLD-Pnn` (pièce + carton, barcodes, 3 price levels); 3 promotions (2 %, 1 free units) |
| Stock | a purchase into the main dépôt when it runs low, then a validated chargement today on each of the 6 trucks (10-14 lines) and a draft chargement for the magasinier |
| Tournées | one route per vendeur (11 stops, nearest-neighbour order, every weekday) and one per LIV truck |
| Today | per vendeur: an open session, 3 van sales (paid / part paid / credit) each with a visit, a cheque versement, a NO_SALE visit; one far sale flagged by the GeoCheck (with a note) for one vendeur per team; 2 pending location change requests |
| Orders | 10 confirmed: 6 on the LIV trucks, 4 not assigned |
| History (not with `--today`) | 30 days, 2 sales per vendeur per day; yesterday closed for each vendeur with an écart; this month's targets (CA HT, encaissement, visites) per vendeur and per team; a draft inventory count on the main dépôt |

## Limits of the API, and what the seed does about them

- **Payments cannot be dated**: the history has no past versements (history sales are paid at sale, by
  the owner, so they do not count in any vendeur's cash of the day). Today's versement is real.
- **The expected cash of a past day is always 0**: the closed yesterday shows an écart equal to the cash
  handed. Today's sessions are left open for you to test the clôture.
- **Routes have no date**: they recur every weekday, so every morning has a tournée.
- The company-name pattern and the town centres (approximate) are assumptions: check them on the dry run.
