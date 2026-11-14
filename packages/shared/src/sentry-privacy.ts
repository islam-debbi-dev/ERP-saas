/**
 * Audit 02, B-2: what never leaves for Sentry, a third party. One scrub for the API, the
 * browser and the server-side rendering, on error events, transactions, spans and breadcrumbs:
 *
 *  - no request body (`request.data` of an event, `http.request.body.data` of a span): it
 *    holds passwords at login, cheque numbers in a versement, salaries in a payslip;
 *  - no cookie and no `Authorization` header, whatever name the SDK files them under;
 *  - no one-time token in a URL (`/s/<token>`, `/auth/invitations/<token>`, the web's
 *    `/invitation/<token>`): whoever reads it could open the document or take the account;
 *  - no position (phase 35), through the walker of `position-privacy.ts`.
 */
import { isPositionParam, scrubPayload, stripPositionParams } from './position-privacy';

/** Compared in lower case, as object keys and as span attribute names. */
const SECRET_KEYS = new Set([
  'http.request.body.data',
  'http.request.header.cookie',
  'http.request.header.authorization',
  'http.response.header.set-cookie',
  'cookie',
  'cookies',
  'set-cookie',
  'authorization',
  'password',
  'currentpassword',
  'newpassword',
  'accesstoken',
  'refreshtoken',
]);

/** The path segment before a one-time token, then the token (32 random bytes, hex or base64url). */
const LINK_TOKEN = /(\/(?:s|invitations?)\/)[A-Za-z0-9_-]{16,}/g;
const LINK_HINT = /\/(?:s|invitations?)\//;

/** Any text (URL, path, span name) with its share or invitation token replaced. */
export function stripLinkTokens(text: string): string {
  return LINK_HINT.test(text) ? text.replace(LINK_TOKEN, '$1[token]') : text;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

const RULES = {
  dropKey: (key: string) => isPositionParam(key) || SECRET_KEYS.has(key.toLowerCase()),
  cleanString: (text: string) => stripLinkTokens(stripPositionParams(text)),
};

/**
 * Scrubs a Sentry payload **in place** and returns it. Given to `beforeSend`,
 * `beforeSendTransaction`, `beforeSendSpan` and `beforeBreadcrumb`.
 */
export function scrubSentry<T>(payload: T): T {
  // `data` is too common a name to drop everywhere (a span keeps its attributes there):
  // the body of the request sits in `request.data` of an event.
  if (isRecord(payload) && isRecord(payload['request'])) delete payload['request']['data'];
  return scrubPayload(payload, RULES);
}
