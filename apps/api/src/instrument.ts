// Imported first in main.ts so Sentry can instrument everything loaded after it.
import * as Sentry from '@sentry/nestjs';
import { scrubSentry } from '@erp/shared';

const dsn = process.env['SENTRY_DSN'];
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env['APP_ENV'] ?? process.env['NODE_ENV'] ?? 'development',
    release: process.env['SENTRY_RELEASE'] || undefined,
    tracesSampleRate: 0.1,
    // Sentry is a third party. By default the SDK keeps the body of every incoming request
    // (on each 500, and on one request in ten as a trace attribute): passwords at login,
    // cheque numbers, salaries (audit 02, B-2). It is not read at all here…
    integrations: [Sentry.httpIntegration({ maxRequestBodySize: 'none' })],
    // …and whatever still carries a body, a cookie, a one-time link token or the user's
    // position (phase 35) loses it before it leaves: packages/shared/src/sentry-privacy.ts.
    beforeSend: scrubSentry,
    beforeSendTransaction: scrubSentry,
    beforeSendSpan: scrubSentry,
    beforeBreadcrumb: scrubSentry,
  });
}
