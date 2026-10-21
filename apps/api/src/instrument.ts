// Imported first in main.ts so Sentry can instrument everything loaded after it.
import * as Sentry from '@sentry/nestjs';

const dsn = process.env['SENTRY_DSN'];
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env['APP_ENV'] ?? process.env['NODE_ENV'] ?? 'development',
    release: process.env['SENTRY_RELEASE'] || undefined,
    tracesSampleRate: 0.1,
  });
}
