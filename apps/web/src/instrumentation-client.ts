// Browser errors → Sentry, when the image was built with NEXT_PUBLIC_SENTRY_DSN.
// One image serves staging and production, so the environment comes from the host.
import * as Sentry from '@sentry/nextjs';
import { scrubSentry } from '@erp/shared';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

function environmentOf(host: string): string {
  if (host === 'localhost' || host.startsWith('127.')) return 'local';
  return host.startsWith('staging.') ? 'staging' : 'production';
}

if (dsn) {
  Sentry.init({
    dsn,
    environment: environmentOf(window.location.hostname),
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || undefined,
    tracesSampleRate: 0.1,
    // Phase 35: the position sent to "Clients proches" is never kept. The SDK keeps every
    // fetch URL as a breadcrumb and as a span, and sends them with the next error.
    // No request body, cookie or one-time link token either (audit 02, B-2).
    beforeBreadcrumb: scrubSentry,
    beforeSend: scrubSentry,
    beforeSendTransaction: scrubSentry,
    beforeSendSpan: scrubSentry,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
