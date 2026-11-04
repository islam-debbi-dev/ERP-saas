Read AGENTS.md and docs/architecture.md (Auth) before doing anything. Read `apps/api/src/auth` fully (`auth.service.ts`, `auth.controller.ts`, `jwt-auth.guard.ts`, `token.service.ts`, `login-limiter.ts`), `apps/web/src/lib/auth.tsx`, `apps/web/src/lib/api-client.ts`, `apps/web/src/lib/session-hint.ts`, `apps/web/src/lib/impersonation.ts`, `packages/shared/src/schemas/tenant-settings.ts` and `apps/web/src/components/users/sessions-page.tsx`.

## Task: Phase 32 — Verrouillage automatique (idle lock screen + PIN)

Branch: `phase-32-idle-lock`. Phases 1–26 are merged (30 and 31 may or may not be; this phase does not depend on them). No feature flag: this is core security, on for every plan and edition.

The need: a trader leaves the shop counter, the screen stays open on a client's credit or the caisse. After a short time without activity the app hides everything and asks for the user's PIN (or password). Someone walking up to the phone or PC cannot see or do anything, and reloading the page does not get around it.

### Domain rules
- **Lock = the session is locked, not logged out.** The page stays mounted under the lock screen so a half-typed sale, cart or form is still there after unlock. Nothing is lost, nothing is sent while locked.
- **The lock is enforced by the API, not only drawn by the web.** While a session is locked, every authenticated route refuses with `SESSION_LOCKED` (HTTP 423), and `/auth/refresh` refuses too. Reload, a new tab, or devtools on the access token give nothing. The only routes that work on a locked session are `/auth/unlock`, `/auth/logout` and `/auth/lock`.
- **PIN**: 4 to 6 digits, per user, optional. Stored as an argon2id hash (`User.pinHash`, `User.pinSetAt`), never logged, never returned. Refused PINs (`PIN_TOO_WEAK`): all the same digit (`0000`, `111111`), straight runs up or down (`1234`, `987654`), and the last 4 to 6 digits of the user's own phone number. Setting or changing the PIN asks for the current password. Without a PIN the user unlocks with the password.
- **Wrong unlock attempts**: counted on the session (`Session.unlockFailedCount`). After 5 wrong attempts the session is revoked (`revokedReason = 'UNLOCK_FAILED'`): the user must log in again with the password. The account itself is not locked (that stays the login rule of 5 wrong passwords → 15 minutes). The unlock route also goes through the login limiter by IP.
- **Delay**: tenant setting `idleLockMinutes`, one of `0` (off), `1`, `2`, `5`, `10`, `15`, `30`; default `5`. Only OWNER changes it (audited). A user can pick a **shorter** delay for himself on his profile (`User.idleLockMinutes`, nullable = follow the company); never longer than the company's, and never off when the company has it on.
- **Activity** = pointer down, key down, touch start, wheel/scroll, and the page becoming visible. Mouse moves alone do not count (a mouse bumped on the counter must not keep the screen open). Background work (TanStack Query refetches, polling) never counts as activity.
- **One lock for all tabs of the browser.** Activity in any tab keeps all of them open; locking or unlocking in one tab does it in all (`BroadcastChannel`, with a `storage` event fallback).
- **Timestamps, not timers.** The web keeps `lastActivityAt` (localStorage, no secret in it) and checks `now - lastActivityAt` on a short interval and on `visibilitychange` / `focus` / `pageshow`, because phones and background tabs freeze timers. A phone that comes back after 20 minutes in the pocket shows the lock screen before any content.
- **Reopening the browser**: if the tab was closed and the app is opened again after more than the delay since the last activity, it starts locked (the refresh call answers `SESSION_LOCKED`, see Lock below).
- **Lock now**: a "Verrouiller" item in the user menu, and `Ctrl+Shift+L` on desktop (not `Ctrl+L`: that is the browser's address bar).
- **Who is not locked**: the super-admin read-only support view (impersonation, its own short token, no refresh cookie) and the public share-link pages (phase 21). A user with `mustChangePassword` sees the password change screen, not the lock screen.
- **Logout from the lock screen**: "Ce n'est pas moi / Se déconnecter" ends the session (normal logout) and goes to the login page. This is how another employee takes the device.
- **Audit** (phase 11 log, with device): `SESSION_LOCKED` (reason IDLE / MANUAL), `SESSION_UNLOCKED` (method PIN / PASSWORD), `SESSION_UNLOCK_FAILED`, `SESSION_REVOKED_UNLOCK_FAILED`, `USER_PIN_SET`, `USER_PIN_REMOVED`, `USER_PIN_RESET_BY_OWNER`, `TENANT_IDLE_LOCK_CHANGED`. Never the PIN itself.

### Schema (one migration, additive only)
- `User`: `pinHash String? @db.VarChar(255)`, `pinSetAt DateTime?`, `idleLockMinutes Int? @db.SmallInt`.
- `Session`: `lockedAt DateTime?`, `lockReason String? @db.VarChar(10)` (IDLE | MANUAL), `unlockFailedCount Int @default(0) @db.SmallInt`.
- Tenant settings: `idleLockMinutes` in `tenantSettingsSchema` (zod enum of the allowed values, default 5), so existing tenants get 5 without a data migration.
- `revokedReason` gains the value `UNLOCK_FAILED` (it is a varchar, no enum change).

### Lock (server side)
- `POST /auth/lock` `{ reason: 'IDLE' | 'MANUAL' }` sets `Session.lockedAt` (only if null: idempotent, keeps the first time). It accepts **either** the access token **or** the refresh cookie (cookie path is `/auth`), so the web can send it with `navigator.sendBeacon` on `pagehide` even after it has dropped the access token.
- **Server-side idle check at refresh**: the refresh cookie route also locks the session by itself when the client says so. The web sends `lastActivityAt` in the refresh body; if `now - lastActivityAt > delay` the API sets `lockedAt` and answers `SESSION_LOCKED`. (The API cannot see clicks, so this is how a reopened tab ends up locked even when the beacon never arrived.) A missing `lastActivityAt` from a web client is treated as "active now" so old tabs keep working during the deploy.
- `jwt-auth.guard.ts` already loads the session on every request: add `if (session.lockedAt) throw SESSION_LOCKED` right after the revoked / expired checks, with an allow-list for the three routes above (a decorator, like the existing public / password-change exceptions).
- `SESSION_LOCKED` error `details`: `{ fullName, hasPin, lockedAt }` so the lock screen can greet the user and show the right keypad without another call.
- Native clients (phase 19 later) use the same routes with the refresh token in the body (`x-client-type: native`), like refresh today.

### Unlock
- `POST /auth/unlock` `{ pin } | { password }` with the refresh cookie (web) or refresh token in the body (native). In one transaction with the session row locked (`SELECT ... FOR UPDATE`): check the session is live and locked, verify against `pinHash` or `passwordHash` (argon2, with the dummy-hash timing guard used at login), then either
  - OK: clear `lockedAt`, `lockReason`, `unlockFailedCount`, **rotate the refresh token** exactly like `refresh()` does, return a new access token (same response shape as refresh);
  - wrong: increment `unlockFailedCount`, answer `INVALID_PIN` / `INVALID_CREDENTIALS` with `details.attemptsLeft`; at 5, revoke the session and answer `SESSION_REVOKED`.
- Unlocking a session that is not locked just behaves like a refresh (two tabs both submitting the PIN must not fail the second one).

### PIN management
- `PUT /auth/me/pin` `{ currentPassword, pin }` sets or changes the PIN. `DELETE /auth/me/pin` `{ currentPassword }` removes it.
- `POST /users/:id/pin/reset` (OWNER, `USER_MANAGE`): removes another user's PIN (the user then unlocks with the password and can set a new one). The owner never sees or sets someone else's PIN.
- `PATCH /auth/me` gains `idleLockMinutes` (validated against the company value: `IDLE_LOCK_TOO_LONG`).
- `GET /auth/me` returns `hasPin` and `effectiveIdleLockMinutes`.
- New error codes in `packages/shared/errors.ts`: `SESSION_LOCKED`, `INVALID_PIN`, `PIN_TOO_WEAK`, `PIN_NOT_SET`, `IDLE_LOCK_TOO_LONG`.
- Shared: `pinSchema`, `isWeakPin(pin, phone?)`, `effectiveIdleLockMinutes(tenant, user)` in `packages/shared` (used by api and web).

### Web
- Every screen follows [`docs/ui.md`](../ui.md): phone first (360 px, `ar` RTL), card lists below `md`, `ResponsiveDialog`, sticky main action. Load the UI skills before building screens and run the audit skill on them at the end.
- **`IdleLockProvider`** inside `AuthProvider`, around the app shell (not around login, register, invitation, share-link pages). It tracks activity, decides when to lock, talks to the other tabs, and owns the lock state.
- **When it locks**: in this order, synchronously, before anything else renders: show the lock screen, set `inert` and `aria-hidden` on the app root (no focus, no screen reader, no click reaches the page), drop the in-memory access token (`api.setAccessToken(null)`), pause TanStack Query (`queryClient` focus/online managers off, no refetch), then send `POST /auth/lock` (fetch with the token if still there, else `sendBeacon`). Requests already in flight that come back `SESSION_LOCKED` must not show an error toast or log the user out: `api-client.ts` turns that code into "lock now" and keeps the request to retry after unlock **only if it is a GET**. A POST that failed with `SESSION_LOCKED` is not retried by itself: the form keeps its values and its `Idempotency-Key`, so pressing the button again after unlock is safe.
- **Lock screen**: full-screen opaque layer (no blur that lets amounts show through), company name and logo, user's name, a large numeric keypad for the PIN (works on touch and with the keyboard, `inputmode="numeric"`, `autocomplete="off"`, digits shown as dots), a "Utiliser le mot de passe" link, the attempts left after a mistake, and "Ce n'est pas moi / Se déconnecter". No auto-submit (PINs are 4 to 6 digits and the length is not returned): a "Déverrouiller" button plus Enter. Same layout in ar (RTL), fr, en. The browser tab title becomes the app name only (no client name in the tab while locked).
- **Before the lock**: no countdown warning dialog (it would itself show over the data); the lock is silent.
- **Profile page** ("Mon compte"): "Code PIN" card (set / change / remove, asks the current password), "Verrouillage automatique" select limited to values ≤ the company's.
- **Settings** (OWNER): "Sécurité" card with `idleLockMinutes`.
- **Users page**: "Réinitialiser le PIN" action for the owner; the list shows whether each user has a PIN.
- **Sessions page** (phase 11): show "Verrouillée depuis HH:mm" on locked sessions.
- Strings in `ar`, `fr`, `en` messages files.

### Tests
- Playwright mobile (`e2e/web/mobile.spec.ts`): the lock screen, the PIN card and the security setting at 360 and 393 px in `ar` and `fr`, no horizontal overflow, keypad and "Déverrouiller" visible without scrolling; screenshots in `e2e/artifacts/mobile/`.
- Playwright (`e2e/web/web.spec.ts`), with a test-only short delay (`idleLockMinutes` cannot be under 1, so drive the clock with Playwright `page.clock`): idle → locked → amounts not in the DOM's visible text and the page is `inert`; reload while locked → still the lock screen; second tab locks and unlocks with the first; a half-typed sale is still there after unlock; wrong PIN 5 times → back to login.
- Unit (shared): `isWeakPin` (every rule, with and without a phone), `effectiveIdleLockMinutes` (user shorter, user longer refused, company off).
- Unit (web): the idle tracker with fake timers: mouse move does not count, key / touch does, a frozen-timer gap (jump the clock 20 min, then fire `visibilitychange`) locks immediately.
- Integration (API, real DB): lock → every business route answers 423, `/auth/refresh` answers 423, `/auth/unlock` / `/auth/logout` work; unlock with PIN and with password rotates the refresh token (the old one is refused after the grace window); 5 wrong PINs revoke the session but the user can still log in with the password; two concurrent unlocks with the right PIN both succeed; refresh with a stale `lastActivityAt` locks the session; `/auth/lock` with only the refresh cookie works; weak PINs and the phone-digits PIN refused; owner PIN reset removes the hash and is audited; user delay longer than the company's refused; support view (impersonation token) is never locked; tenant isolation (owner of A cannot reset a PIN in B, a session of A cannot be locked or unlocked with B's data).

### Not in this phase
Biometric unlock (WebAuthn / fingerprint on the phone; good candidate for the Flutter app), lock on the Flutter app (phase 19 reuses these routes), different delays per role, a "quick switch user" with several PINs on one shared caisse device, forcing a PIN for every user (parked: decide after the pilot).

### Definition of done
AGENTS.md §10. Summary ends with What / How to test manually / Decisions / Next phase.
