/**
 * Every error code the API can return in `{ code, message, details? }`.
 * The web maps them to French messages in its messages file.
 */
export const ErrorCode = {
  // Generic
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  FORBIDDEN: 'FORBIDDEN',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  DB_UNAVAILABLE: 'DB_UNAVAILABLE',
  // Auth
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  SESSION_REVOKED: 'SESSION_REVOKED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  REFRESH_TOKEN_REUSED: 'REFRESH_TOKEN_REUSED',
  EMAIL_ALREADY_USED: 'EMAIL_ALREADY_USED',
  // Tenancy
  TENANT_CONTEXT_MISSING: 'TENANT_CONTEXT_MISSING',
  // Idempotency
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  IDEMPOTENCY_REQUEST_IN_PROGRESS: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Shape of every error body returned by the API. */
export interface ApiError {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

/** Header carrying the idempotency key on POSTs with money or stock effects. */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
/** Header native clients (Flutter) send to receive the refresh token in the body. */
export const CLIENT_TYPE_HEADER = 'X-Client-Type';
