// Server-side rendering errors → Sentry (runtime env: SENTRY_DSN, APP_ENV, SENTRY_RELEASE).
import * as Sentry from '@sentry/nextjs';

export function register(): void {
  const dsn = process.env['SENTRY_DSN'];
  if (!dsn || process.env['NEXT_RUNTIME'] !== 'nodejs') return;
  Sentry.init({
    dsn,
    environment: process.env['APP_ENV'] ?? 'production',
    release: process.env['SENTRY_RELEASE'] || undefined,
    tracesSampleRate: 0.1,
  });
}

export const onRequestError = Sentry.captureRequestError;
