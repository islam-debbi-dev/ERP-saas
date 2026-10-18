import { loadTestEnv } from './load-test-env';

process.env['DATABASE_URL'] = loadTestEnv();
process.env['NODE_ENV'] = 'test';
// TEST_LOG_LEVEL=error pnpm test:int shows server logs when debugging a failure.
process.env['LOG_LEVEL'] = process.env['TEST_LOG_LEVEL'] ?? 'silent';
process.env['JWT_ACCESS_SECRET'] ??= 'test-secret-only-for-integration-tests-123456';
process.env['SENTRY_DSN'] = '';
