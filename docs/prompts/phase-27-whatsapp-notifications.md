Read AGENTS.md, docs/architecture.md and docs/domain.md (Clients & credit, Versements) before doing anything. Read `apps/api/src/payments/payments.service.ts`, `apps/api/src/purchases/supplier-payments.service.ts`, the phase 25 expenses service, `packages/shared/src/phone.ts` and the `runExclusive` helper from phase 23. Read Meta's current WhatsApp Cloud API docs for sending template messages and webhooks before coding the adapter; do not rely on memory for endpoints or versions.

## Task: Phase 27 — WhatsApp channel and cash in / cash out alerts

Branch: `phase-27-whatsapp-notifications`. Phases 1–26 are merged. Feature flag: new `WHATSAPP_NOTIFY` (editions DISTRIBUTION and ENTREPRISE; grantable to others).

The need: the owner (or a person he chooses) gets a WhatsApp message when money comes in or goes out. Phase 28 reuses the same channel for automatic debtor reminders.

### Design (decided with islam, 2026-11-01)
- **Each company uses its own WhatsApp Business number and pays Meta directly.** The platform never sends from a shared number and bills nothing for messages.
- **Connection (v1, manual)**: in Paramètres > WhatsApp the owner enters the WhatsApp Business Account ID, Phone Number ID and a permanent access token (system user token). Store the token encrypted with AES-256-GCM using `WHATSAPP_TOKEN_KEY` (32-byte env var, in `.env.example` and `infra/deploy/env.example`); never return it to the web, never log it. A "Tester" button sends the `hello_world`-type test template to the owner's phone. Embedded Signup (needs Meta Tech Provider status) is parked.
- **Templates**: messages that we start must be approved templates. Ship the template texts (ar and fr, category UTILITY) in `docs/whatsapp-templates.md` with their variables, so the owner can submit them in Meta Business Manager; the tenant maps each event to its approved template name + language in settings. The app checks the template exists (Graph API) when saving.
- **Adapter**: interface `NotificationChannel.send(tenantId, to, template, params)` with `WhatsAppCloudChannel` and `FakeChannel` (tests, and when the tenant has no connection: the event is recorded as `SKIPPED_NOT_CONNECTED`).
- **Outbox (AGENTS §3: one transaction)**: the operation that moves money writes a `NotificationOutbox` row (tenantId, event, refType, refId, recipient, template, params JSON, status `PENDING` / `SENT` / `DELIVERED` / `READ` / `FAILED` / `SKIPPED_*`, attempts, lastError, providerMessageId) **in the same transaction**. After commit the service tries to send right away; a worker under `runExclusive('whatsapp-outbox')` retries `PENDING`/`FAILED` every minute with backoff (1, 5, 15, 60 min, then gives up and shows it). A WhatsApp failure never fails or slows the sale or versement.
- **Webhook** `POST /webhooks/whatsapp/:tenantKey` with Meta signature check (`X-Hub-Signature-256` with the app secret the tenant enters) and the GET verify challenge; updates delivery status by `providerMessageId`. Public route, rate limited.
- **Recipients**: `NotificationSubscription` (tenantId, userId or free phone + name, events, warehouseIds (empty = all), minAmount, active). A phone is only used after opt-in: the app sends a 6-digit code template, the person types it back on the settings screen (store `verifiedAt`). Max 5 recipients per tenant.
- **Events**: `CASH_IN` (versement validated, any mode), `CASH_OUT` (supplier payment, expense), `CHEQUE_BOUNCED`, `PAYMENT_CANCELLED`, and `DAILY_SUMMARY` at 20:00 Algiers (CA, encaissements, décaissements per dépôt; one message). Example CASH_IN params: amount `120 000,00 DA`, dépôt, client, mode, collected by, time.

### API
- `GET/PUT /settings/whatsapp` (token write-only), `POST /settings/whatsapp/test`.
- CRUD `/notification-subscriptions`, `POST /notification-subscriptions/:id/verify`.
- `GET /notifications` (outbox log, cursor, filters) and `POST /notifications/:id/retry`.
- Permission `NOTIFICATIONS_MANAGE` (owner default).

### Web
- Every screen follows [`docs/ui.md`](../ui.md): phone first (360 px, `ar` RTL), card lists below `md`, `ResponsiveDialog`, sticky main action. Load the UI skills before building screens and run the audit skill on them at the end.
- Paramètres > WhatsApp: connection status, step-by-step help in the three languages with links to Meta, template mapping, recipients with their events / dépôts / minimum amount, message log with status icons.

### Tests
- Playwright mobile (`e2e/web/mobile.spec.ts`): each new screen at 360 and 393 px in `ar` and `fr`, no horizontal overflow, main action visible; screenshots in `e2e/artifacts/mobile/`.
- Unit: token encryption round trip and tamper detection; webhook signature check; backoff schedule; message params formatting (amounts in DA, Algiers time).
- Integration (FakeChannel, and a mocked HTTP Meta for the adapter): a versement writes exactly one outbox row per matching recipient in the same transaction (roll the transaction back → no row); idempotent replay of the versement creates no second row; minAmount and dépôt filters; unverified phone gets nothing; the worker sends once even with two API replicas (`runExclusive`); a Meta 500 leaves the versement saved and the row retried; webhook updates status; tenant isolation (a webhook for tenant A cannot touch B's rows).

### Not in this phase
Automatic debtor reminders (28), SMS, e-mail, Embedded Signup, two-way chat with clients (parked).

### Definition of done
AGENTS.md §10. Summary ends with What / How to test manually / Decisions / Next phase (28 Relances automatiques).
