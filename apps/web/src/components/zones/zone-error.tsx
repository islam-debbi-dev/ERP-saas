'use client';

import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useRef } from 'react';
import { ErrorCode } from '@erp/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ApiError } from '@/lib/api-client';
import { useCommunes } from '@/lib/use-communes';
import { useErrorMessage } from '@/lib/use-error-message';
import { errorCommunes } from '@/lib/zones';

/**
 * A refused zone write or seller move, in words: the message (with the other zone's name),
 * the communes concerned and, for a zone still in use, what uses it.
 */
export function ZoneError({ error, children }: { error: unknown; children?: ReactNode }) {
  const t = useTranslations('zones');
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const communes = useCommunes(error !== null);
  // It sits by the end of a long form: on a phone it must come into view by itself,
  // again once the commune names have made it taller.
  const box = useRef<HTMLDivElement>(null);
  const ready = communes.data !== undefined;
  useEffect(() => {
    if (error) box.current?.scrollIntoView?.({ block: 'nearest' });
  }, [error, ready]);
  if (!error) return null;
  const api = error instanceof ApiError ? error : null;
  const names = errorCommunes(error, communes.data, locale);
  const used = api?.details as { cities?: number; sellers?: number } | undefined;
  return (
    // The margin keeps it clear of a dialog's sticky footer.
    <Alert ref={box} variant="destructive" role="alert" className="scroll-mb-28">
      <AlertDescription className="space-y-2">
        <p>{api?.code === ErrorCode.CONFLICT ? t('conflict') : errorMessage(error)}</p>
        {names.length > 0 ? (
          <p className="break-words">
            {t('communesConcerned')} <bdi>{names.join(locale === 'ar' ? '، ' : ', ')}</bdi>
          </p>
        ) : null}
        {api?.code === ErrorCode.ZONE_IN_USE ? (
          <p>{t('inUse', { cities: used?.cities ?? 0, sellers: used?.sellers ?? 0 })}</p>
        ) : null}
        {children}
      </AlertDescription>
    </Alert>
  );
}
