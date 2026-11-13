// Server-side rendering errors → Sentry (runtime env: SENTRY_DSN, APP_ENV, SENTRY_RELEASE).
import * as Sentry from '@sentry/nextjs';
import { scrubPosition } from '@erp/shared';

export function register(): void {
  const dsn = process.env['SENTRY_DSN'];
  if (!dsn || process.env['NEXT_RUNTIME'] !== 'nodejs') return;
  Sentry.init({
    dsn,
    environment: process.env['APP_ENV'] ?? 'production',
    release: process.env['SENTRY_RELEASE'] || undefined,
    tracesSampleRate: 0.1,
    // Same scrub as the browser and the API: no position leaves for Sentry (phase 35).
    beforeBreadcrumb: scrubPosition,
    beforeSend: scrubPosition,
    beforeSendSpan: scrubPosition,
  });
}

export const onRequestError = Sentry.captureRequestError;
