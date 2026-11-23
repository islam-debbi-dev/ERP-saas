# Phase 39 follow-up: API / web fixes parked during M3, M3b and M4

Branch `fix-39-api-followups`. **Migration: no.** Nothing to run on Neon.

## What

| # | Fix | Commit |
|---|---|---|
| 1 | **A supervisor's deliverers are his team.** `GET /orders/deliverers` returns only the livreurs / sellers of his team. `PATCH /orders/:id/livreur` answers **403 `FORBIDDEN`** (`details.field = "livreurId"`) when he names someone outside it, and the order is left unchanged. Owner and manager are unchanged. A delivery truck in his reach stays allowed. | `fix(tournees)` |
| 2 | **`GET /stock-transfers?status=DRAFT\|VALIDATED\|CANCELLED`**, alone or combined with `type`, `toWarehouseId`, `warehouseId` and dates. The phone's Chargements list now asks for `status=DRAFT` and reads every page, instead of keeping the drafts of the latest 300 transfers. | `feat(stock)` |
| 3 | **Blind inventory count on the server.** Without `STOCK_ADJUST`, `expectedQtyBase` and `diffQtyBase` are `null` in `GET /inventories/:id`, and also in the answers of `POST /inventories` and `PUT /inventories/:id/lines`. A `STOCK_ADJUST` user gets the figures. Validation still computes the écart from the live stock. The web count table hides the *Attendu* / *Écart* columns for a blind count, and the phone parses the nulls. | `fix(stock)` |
| 4 | **Web assistant: dates isolated LTR** like amounts (`2026-11-20`, `20/11/2026`, `20/11/26`, `20/11`), with the same rule as the phone in M4, so they no longer flip to `20-11-2026` in Arabic. | `fix(web)` |

## How to test manually

1. **Deliverers.** Make supervisor A with livreur LA (`managerId = A`) and supervisor B with livreur LB.
   - As A, *Commandes* → a confirmed order of A's team → *Livreur*: the picker lists only A's team.
   - As A: `PATCH /orders/<id>/livreur {"livreurId":"<LB>"}` gives 403 `FORBIDDEN`, and the order keeps its livreur.
   - As the owner: everyone is listed, and LB can be assigned.
   - As A: `{"deliveryVehicleId":"<truck>"}` still works for a truck he reaches.
2. **Status filter.** `GET /stock-transfers?status=DRAFT` returns only drafts, and `?status=OPEN` gives 400.
   - On the phone (storekeeper → *Chargements*), open drafts still show first, even after more than 300 transfers.
3. **Blind count.**
   - As a storekeeper without STOCK_ADJUST (web *Stock → Inventaires*, or the phone), open a count and count a product: no *Attendu* or *Écart* column. `GET /inventories/<id>` has `"expectedQtyBase": null`.
   - As the owner, the same count shows both, and *Valider* posts the écart.
4. **Assistant dates.** In `ar`, ask « ما هي فواتير الأسبوع؟ » (or anything that answers with dates). `2026-11-20` and `20/11/2026` read left to right, like the amounts.

## Decisions

- **No new error code.** A supervisor naming someone outside his team gets the existing `FORBIDDEN`, already translated on the web and the phone (ar, fr, en). That is also what `resolveTourneeSeller` answers for a seller outside the team. The team check is now one helper, `assertTeamMember` in `tournee-scope.ts`, used by both. The list side reuses `tourneeSellerIds`, the rule of seller-sessions and tournées.
- **An order outside the supervisor's team answers 404 `ORDER_NOT_FOUND`, not 403.** That is the API's existing rule for every row out of reach (`lockVisible` / `assertVisible`). It does not reveal that the id exists. Only a named *user* outside the team gets 403.
- **The truck path is unchanged.** A truck is checked with the existing warehouse reach (`scope.assertWarehouse`). Its driver of the day is not team-checked: a supervisor may put an order on a truck he reaches even when another team drives it, as the prompt asked.
- **Unassigning (`livreurId: null`) stays allowed** to a supervisor on his team's orders.
- **No index for the status filter.** `stock_transfers` already has `@@index([tenantId, status])`, so no migration.
- **The phone keeps its own DRAFT check** after `status=DRAFT`. An API older than this branch ignores the unknown parameter, and the phone stays correct against it. The page cap went from 3 to 10 pages of 100 (a safety net; a dépôt has a handful of drafts).
- **The blind rule is "no STOCK_ADJUST"**, the same permission as validation and as the phone's M3b screen. It also applies once the count is validated. `validate` and `cancel` need STOCK_ADJUST, so their answers keep the figures. The inventory list returns no lines and is unchanged.
- **`splitAmounts` keeps its name.** Its parts now carry `kind: 'text' | 'amount' | 'date'` instead of `amount: boolean`. Its only reader is `assistant-markdown.tsx`. Dates are matched before amounts. Like the phone, `20/11` (no year) counts as a date, and a fraction like `1/2` is then shown LTR, which is harmless.

## Checks (local, 2026-11-23, Node 22.23.5, fresh Postgres 16 on port 5434)

| Check | Result |
|---|---|
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test --force`: shared | ✅ 41 files |
| `pnpm test --force`: web | ✅ 13 files |
| `pnpm test --force`: API, full run | ⚠️ 44 / 74 suites, 480 / 1000 tests. The Mac was overloaded (load average 14–20, iOS simulator and Chrome open, disk 98 % full; the `seed` suite took 74 min). Every failure was Jest's 5 s timeout, or a 500 at tenant setup from Prisma `P2028` ("Unable to start a transaction in the given time"). |
| API: the 30 failed suites rerun alone, same DB | ✅ 30 / 30 suites, 577 / 577 tests. `billing` had 1 timeout on its first rerun and was 10 / 10 on the next. 44 + 30 = all 74 suites green. CI's run is the reference. |
| `flutter analyze` (apps/mobile) | ✅ no issues |
| `flutter test` (apps/mobile) | ✅ 346 tests |

## Notes

- PR #87 (M4) was **not merged** when this branch was cut from `main` (#86). These fixes touch none of M4's files (mobile i18n, `error_messages.dart`, assistant screens), so the rebase after #87 should be clean.
- Fix 1's tests made the tournées suite log in more than 10 times a minute. Each test login now sends its own `X-Forwarded-For`, like the vehicles and users suites, so the login limiter stays out of the way.
