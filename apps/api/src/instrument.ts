// Imported first in main.ts so Sentry can instrument everything loaded after it.
import * as Sentry from '@sentry/nestjs';
import { scrubPosition } from '@erp/shared';

const dsn = process.env['SENTRY_DSN'];
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env['APP_ENV'] ?? process.env['NODE_ENV'] ?? 'development',
    release: process.env['SENTRY_RELEASE'] || undefined,
    tracesSampleRate: 0.1,
    // Phase 35: the user's position ("Près de moi") is never kept, and Sentry is a third
    // party. Errors carry the request URL and query string, spans carry `url.full`.
    beforeSend: scrubPosition,
    beforeSendSpan: scrubPosition,
    beforeBreadcrumb: scrubPosition,
  });
}
