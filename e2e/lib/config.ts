import { fileURLToPath } from 'node:url';

/** Endpoints and connection strings used by the e2e suite. Override with env vars. */
export const API = process.env['API'] ?? 'http://localhost:3001';
export const WEB = process.env['WEB'] ?? 'http://localhost:3000';
/** Dev database (read-mostly for the checks, used to count rows). */
export const DB = process.env['DB'] ?? 'postgresql://erp:erp@localhost:5432/erp';
/** Test database (DATABASE_URL_TEST). Only the repo's own integration tests reset it. */
export const DB_TEST = process.env['DATABASE_URL_TEST'] ?? 'postgresql://erp:erp@localhost:5433/erp_test';

export const ARTIFACTS = fileURLToPath(new URL('../artifacts/', import.meta.url));
