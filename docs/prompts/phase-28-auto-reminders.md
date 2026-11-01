Read AGENTS.md and docs/domain.md (Clients & credit) before doing anything. Read `apps/api/src/credit/aging.service.ts`, `apps/api/src/clients` ("Clients à relancer"), `apps/api/src/printing/share-links.service.ts` and the phase 27 notifications module fully.

## Task: Phase 28 — Relances automatiques des débiteurs

Branch: `phase-28-auto-reminders`. Phases 1–27 are merged. Feature flag: `WHATSAPP_NOTIFY` (from phase 27). Needs the tenant's WhatsApp connection; without it the screen explains how to connect and nothing is sent.

The need: the system reminds debtor clients on WhatsApp by itself, on a schedule, and the owner can exclude some clients.

### Domain rules
- **Who is due** = the phase 21 "Clients à relancer" rule (balance > 0 and oldest unpaid document older than `reminderDays`), plus: balance ≥ `reminderMinAmount`, client `autoReminders = true`, not paused (`remindersPausedUntil` null or past), has a valid mobile phone, and no reminder sent to him in the last `reminderEveryDays` days.
- **Tenant settings** (in the existing settings schema): `autoRemindersEnabled` (default false: the owner turns it on deliberately), `reminderEveryDays` (default 7), `reminderMinAmount` (default 1 000 DA), `reminderSendAt` (default 10:00 Algiers), `reminderSkipDays` (default Friday), `reminderMaxPerRun` (default 200), template + language per client language (ar / fr).
- **Per client**: `Client.autoReminders` (default true), `remindersPausedUntil` (date, e.g. "il a promis de payer à la fin du mois"), `preferredLanguage` (ar / fr). Changing them is audited. Bulk action on the clients list: exclude / include / pause until.
- **Message**: approved UTILITY template (texts added to `docs/whatsapp-templates.md`): company name, client name, balance, oldest unpaid date, and a **share link to the relevé** (phase 21 share link, 7 days). Polite wording, no threat.
- **ReminderLog** (tenantId, clientId, runDate (Algiers), balance at send, outboxId, status mirrored from the outbox); unique on (tenantId, clientId, runDate) so a client never gets two reminders the same day, even if the run is repeated.
- A versement after the reminder does not cancel anything; the next run simply finds the client not due.

### Run
- Daily job under `runExclusive('auto-reminders')` that, for each tenant with the setting on, runs at its `reminderSendAt`, skips `reminderSkipDays`, picks due clients oldest debt first up to `reminderMaxPerRun`, and writes outbox rows (phase 27 sends them). Each tenant in its own transaction; one tenant's failure is logged to Sentry and does not stop the others. Runs in `tenantContext` of that tenant (RLS on).
- A missed run (server down) catches up the same day only; never sends yesterday's batch tomorrow.

### API
- `GET/PUT` the reminder settings; `PATCH /clients/:id` gains the three fields; `POST /clients/reminders/bulk` (exclude / include / pause).
- `GET /reminders/preview` → who would get a message at the next run, with the reason others are left out (excluded, paused, no phone, under minimum, reminded N days ago).
- `POST /reminders/run-now` (owner, once per day, idempotent through ReminderLog).
- `GET /reminders` (log, cursor).

### Web
- Every screen follows [`docs/ui.md`](../ui.md): phone first (360 px, `ar` RTL), card lists below `md`, `ResponsiveDialog`, sticky main action. Load the UI skills before building screens and run the audit skill on them at the end.
- "À relancer" page gains: an "Automatique" switch with the settings, "Prochain envoi" preview list where a client can be excluded or paused with one tap, and the log with delivery status.
- Client page: "Relances automatiques" toggle, pause until, language.

### Tests
- Playwright mobile (`e2e/web/mobile.spec.ts`): each changed screen at 360 and 393 px in `ar` and `fr`, no horizontal overflow, main action visible; screenshots in `e2e/artifacts/mobile/`.
- Unit: due-client selection (every exclusion reason), send time and skip days in Algiers time, catch-up rule.
- Integration (FakeChannel): run twice the same day → one message per client; excluded and paused clients get nothing; a client reminded 3 days ago with every-7-days is skipped; max per run respected; setting off → nothing; one tenant throwing does not stop another; two replicas run the job once; tenant isolation.

### Not in this phase
Escalation levels (1st, 2nd, final notice), automatic credit block after N reminders, SMS fallback (parked).

### Definition of done
AGENTS.md §10. Summary ends with What / How to test manually / Decisions / Next phase (29 Édition mono-société).
