import { useTranslations } from 'next-intl';
import { ErrorCode } from '@erp/shared';
import { ApiError } from './api-client';

const KNOWN = new Set<string>([...Object.values(ErrorCode), 'NETWORK']);

/** Translated message for anything thrown by an API call. */
export function useErrorMessage(): (err: unknown) => string {
  const t = useTranslations('errors');
  return (err) => {
    const code = err instanceof ApiError && KNOWN.has(err.code) ? err.code : 'INTERNAL_ERROR';
    return t(code as ErrorCode | 'NETWORK', messageValues(err));
  };
}

/** The error's details a message may name, such as the other zone's name (phase 40b). */
function messageValues(err: unknown): Record<string, string | number> {
  const details = err instanceof ApiError ? err.details : undefined;
  if (typeof details !== 'object' || details === null) return {};
  return Object.fromEntries(
    Object.entries(details).filter(
      (e): e is [string, string | number] => typeof e[1] === 'string' || typeof e[1] === 'number',
    ),
  );
}
