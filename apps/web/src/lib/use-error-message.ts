import { useTranslations } from 'next-intl';
import { ErrorCode } from '@erp/shared';
import { ApiError } from './api-client';

const KNOWN = new Set<string>([...Object.values(ErrorCode), 'NETWORK']);

/** Translated message for anything thrown by an API call. */
export function useErrorMessage(): (err: unknown) => string {
  const t = useTranslations('errors');
  return (err) => {
    const code = err instanceof ApiError && KNOWN.has(err.code) ? err.code : 'INTERNAL_ERROR';
    return t(code as ErrorCode | 'NETWORK');
  };
}
