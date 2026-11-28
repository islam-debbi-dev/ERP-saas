'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { wilayaLabel } from '@erp/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { communeDisplay } from '@/lib/locations';
import { useCommunes } from '@/lib/use-communes';

const SHOWN = 6;

/** What a zone or an assignment covers, by name; a long list opens with a tap. */
export function PlaceNames({
  wilayaCodes = [],
  communeCodes,
}: {
  wilayaCodes?: number[];
  communeCodes: number[];
}) {
  const t = useTranslations('zones');
  const locale = useLocale();
  const communes = useCommunes(communeCodes.length > 0);
  const [all, setAll] = useState(false);
  const names = [
    ...wilayaCodes.map((code) => ({
      key: `w${code}`,
      label: t('wholeWilaya', { name: wilayaLabel(code, locale) ?? String(code) }),
    })),
    ...communeCodes.map((code) => ({
      key: `c${code}`,
      label: communeDisplay(communes.data, code, null, locale) ?? String(code),
    })),
  ];
  if (names.length === 0) return <p className="text-sm text-muted-foreground">{t('noCommune')}</p>;
  const shown = all ? names : names.slice(0, SHOWN);
  return (
    <div className="space-y-1">
      <ul className="flex flex-wrap gap-1">
        {shown.map((n) => (
          <li key={n.key} className="min-w-0 max-w-full">
            <Badge variant="secondary" className="max-w-full font-normal">
              <span dir="auto" className="whitespace-normal break-words">
                {n.label}
              </span>
            </Badge>
          </li>
        ))}
      </ul>
      {names.length > SHOWN ? (
        <Button
          type="button"
          variant="link"
          className="min-h-11 px-0"
          aria-expanded={all}
          onClick={() => setAll(!all)}
        >
          {all ? t('showLess') : t('showMore', { count: names.length - SHOWN })}
        </Button>
      ) : null}
    </div>
  );
}
