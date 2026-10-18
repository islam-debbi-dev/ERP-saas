import { ApiError } from './api-client';
import { errorMessage } from './i18n';

/** French message for anything thrown by a mutation. */
export function messageFor(err: unknown): string {
  return errorMessage(err instanceof ApiError ? err.code : undefined);
}
