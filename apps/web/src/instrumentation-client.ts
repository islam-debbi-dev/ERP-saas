// Browser errors → Sentry, when the image was built with NEXT_PUBLIC_SENTRY_DSN.
// One image serves staging and production, so the environment comes from the host.
import * as Sentry from '@sentry/nextjs';

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
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
