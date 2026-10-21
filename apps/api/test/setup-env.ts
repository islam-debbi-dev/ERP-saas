import { loadTestEnv } from './load-test-env';

const urls = loadTestEnv();
process.env['DATABASE_URL'] = urls.app;
process.env['DATABASE_URL_MIGRATE'] = urls.owner;
process.env['NODE_ENV'] = 'test';
// TEST_LOG_LEVEL=error pnpm test:int shows server logs when debugging a failure.
process.env['LOG_LEVEL'] = process.env['TEST_LOG_LEVEL'] ?? 'silent';
process.env['JWT_ACCESS_SECRET'] ??= 'test-secret-only-for-integration-tests-123456';
process.env['SENTRY_DSN'] = '';
