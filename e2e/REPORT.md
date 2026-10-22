# Audit report — ERP SaaS

**Target:** `b71f500` (branch `test/e2e-audit`, phases 1–11) — API and web built from that commit.
**Date:** 2026-10-21
**Environment:** Node 22, PostgreSQL 16 (docker `erp-saas-db-1`, host port 5432), Next.js 14 web served on
`http://localhost:3005`, API on `http://localhost:3003`, Chromium (Playwright 1.56).

## 1. What was audited

| Suite | File | What it covers |
|---|---|---|
| Business scenario | `e2e/api/scenario.ts` | The whole sales chain: credit sale, partial payment, return (avoir), cancellation, counter sale, invoice grouping, document numbering, audit trail. |
| Attack suite | `e2e/api/attacks.ts` | Tenant isolation, idempotency, permissions, money precision, concurrency, authentication, state machine, injection / mass assignment, audit trail and timestamps. |
| Database invariants | `e2e/sql/invariants.sql` | 20 invariants read straight from the database (stock = ledger, balance = ledger, numbering, tenant index, money scale…). |
| Web audit | `e2e/web/web.spec.ts` | The real browser: login, session restore, logout, money display, XSS, hostile URL, idempotency key from the screen. |

Everything is written against the **real** API and the **real** database. No mock, no stub.

## 2. How to reproduce

```bash
# 1. the database
docker compose -f infra/docker-compose.yml up -d db db_test

# 2. the API and the web (from the audited commit)
NEXT_PUBLIC_API_URL=http://localhost:3003 pnpm build
PORT=3003 WEB_ORIGIN="http://localhost:3005" node apps/api/dist/main.js
NEXT_PUBLIC_API_URL=http://localhost:3003 pnpm --filter @erp/web start --port 3005

# 3. the audit
cd e2e
pnpm install && pnpm exec playwright install chromium
API=http://localhost:3003 pnpm test:api        # scenario + attacks
API=http://localhost:3003 pnpm test:db         # database invariants
WEB=http://localhost:3005 API=http://localhost:3003 pnpm test:web
```

`API` and `WEB` are read from the environment (`e2e/lib/config.ts`). The artifacts land in `e2e/artifacts/`.

## 3. Baseline (before the audit)

| Command | Result |
|---|---|
| `pnpm typecheck` | 4/4 tasks pass |
| `pnpm lint` | 4/4 tasks pass — 7 warnings, 0 errors |
| `pnpm test` (API, Jest) | 20 suites, 205 tests, 2 snapshots — all pass (55.7 s) |
| `pnpm build` | 3/3 turbo tasks pass (25.5 s) |

The repository is green before the audit. The findings below are **not** caught by the existing tests.

## 4. Results

| Suite | Checks | Pass | Fail | Info |
|---|---|---|---|---|
| Business scenario | 17 | 17 | 0 | 0 |
| Attack suite | 48 | 44 | **2** | 2 |
| Database invariants | 20 | 19 | **1** (proof of #1) | 0 |
| Web audit (browser) | 10 | 10 | 0 | 0 |
| **Total** | **95** | **90** | **3** | 2 |

The three failures are the three findings below (#1 is proven twice: by the attack suite and by the database invariant).

---

## 5. Findings

### #1 — The rows of one operation do not share the same `createdAt` (medium)

**Expected.** `AGENTS.md` and the schema say `createdAt` is the timestamp of the transaction: "one timestamp for
the whole transaction". The rows written by one business operation must be able to be recognised as one operation.

**Actual.** Prisma computes `createdAt` **in the client**, so every `create` of the same transaction gets its own
millisecond. One validated BL of 2 units leaves 6 different timestamps:

```
2026-10-21 21:48:29.153+00  xmin=6859  SALE            VALIDATED
2026-10-21 21:48:29.158+00  xmin=6857  AUDIT           SALE_DRAFT_CREATED
2026-10-21 21:48:29.205+00  xmin=6859  SALE_LINE       2.000
2026-10-21 21:48:29.208+00  xmin=6859  STOCKMOV        SALE -2.000
2026-10-21 21:48:29.211+00  xmin=6859  LEDGER          SALE 2380.00
2026-10-21 21:48:29.217+00  xmin=6859  AUDIT           SALE_VALIDATED
distinct createdAt values: 6      distinct xmin values: 2
```

`xmin` proves the rows were committed by the same transaction; the timestamps say otherwise.

**Impact.** The audit trail cannot prove by itself that two rows belong to the same operation: a reader (or a
report that groups by `createdAt`) sees 6 operations where there was 1. The invariant check finds **105 violations**
in the development database, i.e. every business operation ever run.

**Fix.** Let the database stamp the rows: `createdAt DateTime @default(dbgenerated("now()"))` — PostgreSQL's
`CURRENT_TIMESTAMP` is the transaction start time, so every row of the transaction gets the same value. Alternatively,
set `createdAt` explicitly from a single `Date` taken at the beginning of the transaction.

**Reproduction.** `cd e2e && API=http://localhost:3003 pnpm exec tsx api/probe-tx.ts` and
`pnpm test:db` (check `sale_operation_rows_share_created_at`).

---

### #2 — An amount that does not fit in `Decimal(14,2)` answers 500 (high)

**Expected.** A money value outside the column is a client mistake: `400 VALIDATION_FAILED`.

**Actual.** `POST /payments` with `amount: "9999999999999999.99"` answers:

```
HTTP 500 INTERNAL_ERROR {"code":"INTERNAL_ERROR","message":"Internal server error"}
```

The API log shows `PrismaClientKnownRequestError: Invalid tx.payment.create() invocation — Value out of range for
the type: numeric field overflow`. The zod schema checks the scale (2 decimals) but not the maximum, so the value
passes validation and dies in the database layer, where the global filter turns it into a 500.

**Impact.** A 500 on a money path: the client cannot tell a temporary failure from a rejected value, and the
monitoring sees server errors for user input. The same hole exists on every `Decimal(14,2)` column (payments,
sales, purchases, adjustments…).

**Fix.** Add the maximum to the money schema in `packages/shared` (`≤ 999 999 999 999.99`), and map the Prisma
numeric-overflow error to `400 VALIDATION_FAILED` in the global exception filter as a safety net.

**Reproduction.** `e2e/api/attacks.ts`, area D, check *"an amount over Decimal(14,2) is refused with a clean error"*.

---

### #3 — The login rate limit counts the **successful** logins (medium)

**Expected.** A rate limit protects against password guessing. Ten *wrong* passwords in a minute is a problem;
ten *right* ones is normal work.

**Actual.** The limiter counts every attempt, before the password is even checked:

```ts
const keys = [`ip:${meta.ip ?? 'unknown'}`, `id:${input.identifier}`];
if (!this.limiter.hit(keys)) throw new AppException(ErrorCode.TOO_MANY_REQUESTS, ...);
```

`LOGIN_ATTEMPTS_PER_WINDOW = 10`, `LOGIN_WINDOW_MS = 60_000`, and the key `ip:<ip>` is shared by **all** the
accounts of that IP. The eleventh login from the same IP in one minute answers `429 TOO_MANY_REQUESTS`, even with
the right password, even for another account.

**Impact.** A wholesaler behind a shared office IP (or a 4G box, or a NAT at the port) locks the whole company out
for up to a minute at a time — and the lockout looks like "the app is broken". The audit suite tripped it on itself:
the first version of the web audit logged in twice per check and the eleventh login was refused.

**Fix.** Count only the **failed** attempts, per account (`id:<identifier>`), and keep a much larger window for the
IP (or count the IP only for the failed attempts too). A successful login should reset the counter of that
identifier.

**Reproduction.** `e2e/api/attacks.ts`, area F, check *"ten logins from one IP lock out a valid user of another account"*.

---

### #4 — A forged `X-Forwarded-For` bypasses the limit and poisons the audit trail (high)

**Expected.** The IP used to rate limit and to audit a login is the real client IP, and a client cannot choose it.

**Actual.** The API trusts one proxy hop (`trust proxy = 1`), so `req.ip` is the **leftmost** `X-Forwarded-For`
value, which any client can write:

```
POST /auth/login   X-Forwarded-For: 203.0.113.7   →  200, new bucket
POST /auth/login   X-Forwarded-For: 203.0.113.8   →  200, new bucket
…
```

Every forged header opens a fresh bucket: the IP limit of #3 is bypassed entirely (the audit suite sends 15 logins
with 15 different addresses and none of them is refused), and the audit trail records the forged address:
`after.ip = "203.0.113.7"`.

**Impact.** Two problems at once: the brute-force protection does not protect (an attacker rotates the header at
will), and the audit trail — the piece a grosser will read to know where a login came from — can be written by the
client itself.

**Fix.** Do not let a client-supplied header decide the identity of the caller:
- if the API is behind a known reverse proxy (nginx, Traefik), take the address from the **rightmost** trusted
  entry (`trust proxy` set to the real number of hops), or from the proxy's own header that the proxy overwrites;
- otherwise (`trust proxy = false`), use the socket address and ignore `X-Forwarded-For` entirely;
- the limiter and the audit log must use the same trusted source as the rest of the app.

**Reproduction.** `e2e/api/attacks.ts`, area F, checks *"the login rate limit is bypassed with a forged
X-Forwarded-For"* and *"the forged IP is what the audit trail records"*.

---

### #5 — A refresh token replayed inside the grace window is silently accepted (low)

**Expected.** Replaying a refresh token is a theft signal: it must be detected, logged and close the session.

**Actual.** The rotation is a compare-and-swap on `refreshTokenHash`. When the swap fails, the token presented
matches `previousRefreshTokenHash` and the rotation happened less than `REFRESH_REUSE_GRACE_SECONDS` (60 s) ago →
the API accepts it again, rotates again, and **logs nothing**:

```ts
if (swapped.count === 0) {
  const graceStart = new Date(now.getTime() - this.tokens.reuseGraceSeconds * 1000);
  swapped = await this.prisma.db.session.updateMany({
    where: { id: session.id, previousRefreshTokenHash: presentedHash, rotatedAt: { gte: graceStart }, revokedAt: null },
    data: { refreshTokenHash: next.hash, lastUsedAt: now },
  });
}
```

The comment says the grace is for "a reload or a second tab whose response was lost" — a real need, but the price
is that a stolen token works silently for a full minute, and each replay resets the rotation, so the attacker can
keep the session alive as long as he replays inside the window.

**Impact.** A stolen refresh token (from an XSS, a shared computer, a proxy log) leaves no trace for up to 60 s,
and the legitimate user is not disconnected. The attack suite confirms the opposite side: after the window closes,
the session is closed and the reuse is refused (that check passes).

**Fix.** Detect the replay immediately (the grace window should delay the **revocation**, not the **detection**):
log every replay, count them, and close the session after the first or second one. Keep a very short grace for the
"lost response" case, and make the second tab use its own session instead of replaying the token.

**Reproduction.** `e2e/api/attacks.ts`, area F, check *"a refresh token reused after the grace window closes the session"*
(the behaviour inside the window is the gap; see `apps/api/src/auth/auth.service.ts`, `refresh()`).

---

## 6. Observation — fast 500 on `POST /users/invite` and `POST /auth/register` (not reproduced)

During the first full run of the attack suite, against the API instance that had been running for hours, three
checks in area F answered `500 INTERNAL_ERROR` in 42–125 ms on `POST /users/invite` and `POST /auth/register`.
The same requests answered `201` right after, on two other instances, and the whole suite never reproduced it again
(44/48 on a fresh instance, the two failures being #2 and #1 only).

Not enough evidence to call it a finding: no stack trace was captured (the logs of that instance went to a tty).
It is worth keeping an eye on it — both routes create a user inside a transaction, and both are the ones that
create a tenant + a catalog + a user + a session + an audit row at once.

---

## 7. What holds up well

These were checked and behaved correctly:

- **Tenant isolation.** A client of tenant A cannot read, write or list the rows of tenant B; a `tenantId` in the
  body is ignored (the JWT decides); the stocks are not shared.
- **Idempotency.** A money POST without an `Idempotency-Key` is refused; the same key with the same body replays
  the same answer and creates nothing; the same key with another body is refused; a failed request does not burn a
  document number.
- **Permissions.** A SELLER cannot cancel a validated sale, adjust the stock or change the price of a line; a
  MANAGER cannot invite a user; a STOREKEEPER can count but not validate an inventory; a grant is visible at once,
  a revoke too; a deactivated user is locked out and his session dies; a temporary password blocks every route but
  the password change.
- **Concurrency.** Three concurrent payments do not lose an update; two concurrent sales of the last unit respect the
  tenant setting (BLOCK sells one, WARN announces the negative stock).
- **State machine.** A sale cannot be validated twice; a stale version is refused; more than sold cannot be
  returned; a payment made with a sale cannot be cancelled alone; a cash payment cannot bounce; a bounced cheque
  gives the money back; more allocated than paid is refused.
- **Injection and mass assignment.** A hostile id is refused with a clean error (not a 500), a hostile search term
  is harmless, the client balance cannot be written directly, a script tag in a designation is stored as data — and
  the web renders it as text (checked in a real browser: the `window.__pwned` flag never fires).
- **Money.** Three decimals are refused, a quantity with more than three decimals is refused, the totals are exact on
  a non-round price, the balance of a client is shown as `1 190,00 DA` (no float noise), the browser keeps no token
  in `localStorage`/`sessionStorage` and the refresh cookie is `httpOnly` with the path `/auth`.
- **The web.** A wrong password is refused without echoing the secret or the account, a hostile id in the URL gives a
  message and not a crash, the session survives a reload, the log out ends the session, and a payment created from
  the screen carries its `Idempotency-Key`.
- **The database.** 19 invariants out of 20 hold on the live database: stock = ledger, balance = ledger, contiguous
  document numbers, money columns numeric with the right scale, `tenantId` on every business table, composite
  indexes starting with `tenantId`, no orphan ledger rows, a cancelled sale leaves the reversing entries.

---

## 8. Artifacts

| File | Content |
|---|---|
| `e2e/artifacts/scenario.md` / `.json` | The 17 business checks, with the state observed after each operation. |
| `e2e/artifacts/attacks.md` / `.json` | The 48 attack checks, expected vs actual, with the evidence of every failure. |
| `e2e/artifacts/db-invariants.md` / `.json` | The 20 database invariants and the rows that break them. |
| `e2e/artifacts/web.json` | The Playwright report of the 10 browser checks. |
| `e2e/api/probe-tx.ts` | The probe that proves #1 (`createdAt` vs `xmin`). |
