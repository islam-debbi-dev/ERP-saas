'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { wilayaLabel } from '@erp/shared';
import { CommunesLoadError, wilayaOptions } from '@/components/locations/location-picker';
import { OptionField } from '@/components/locations/option-dialog';
import { RemovableChips } from '@/components/locations/removable-chips';
import { communeDisplay, communeOptions, dairaDisplay, dairaOptions } from '@/lib/locations';
import { useCommunes } from '@/lib/use-communes';

const toggle = (list: number[], code: number) =>
  list.includes(code) ? list.filter((c) => c !== code) : [...list, code];

/** Whole wilayas, several of them, as removable chips. */
export function WilayaSetPicker({
  value,
  onChange,
}: {
  value: number[];
  onChange: (next: number[]) => void;
}) {
  const t = useTranslations('zones');
  const locale = useLocale();
  return (
    <div className="grid min-w-0 gap-2">
      <OptionField
        multiple
        label={t('wholeWilayas')}
        placeholder={t('addWilayas')}
        options={wilayaOptions(locale)}
        selectedIds={value.map(String)}
        onPick={(id) => onChange(toggle(value, Number(id)))}
      />
      <RemovableChips
        label={t('chosenWilayas')}
        chips={value.map((code) => ({
          key: String(code),
          label: wilayaLabel(code, locale) ?? String(code),
          onRemove: () => onChange(value.filter((c) => c !== code)),
        }))}
      />
    </div>
  );
}

/**
 * Communes of one or several wilayas, with the 40a pickers: the wilaya and the daïra only
 * choose which list is shown; every chosen commune stays as a chip.
 */
export function CommuneSetPicker({
  value,
  onChange,
  allowed,
}: {
  value: number[];
  onChange: (next: number[]) => void;
  /** A team lead only picks inside his own zones. Absent: every commune. */
  allowed?: ReadonlySet<number>;
}) {
  const t = useTranslations('zones');
  const tl = useTranslations('locations');
  const locale = useLocale();
  const communes = useCommunes();
  const data = communes.data;
  const [wilaya, setWilaya] = useState<number | null>(null);
  const [daira, setDaira] = useState<string | null>(null);
  const shownDaira = data?.dairaByKey(daira);
  const allowedWilayas =
    allowed && data
      ? new Set([...allowed].map((code) => data.communeByCode(code)?.wilayaCode))
      : null;
  const options =
    data && wilaya !== null
      ? communeOptions(data, wilaya, daira, locale, tl('underReview')).filter(
          (o) => !allowed || allowed.has(Number(o.id)),
        )
      : [];

  return (
    <div role="group" aria-label={tl('communes')} className="grid min-w-0 gap-4">
      <OptionField
        label={t('communesOfWilaya')}
        placeholder={tl('chooseWilaya')}
        value={wilayaLabel(wilaya, locale)}
        disabled={Boolean(allowed) && !data}
        options={wilayaOptions(locale).filter(
          (o) => !allowedWilayas || allowedWilayas.has(Number(o.id)),
        )}
        selectedIds={wilaya === null ? [] : [String(wilaya)]}
        onPick={(id) => {
          setDaira(null);
          setWilaya(Number(id));
        }}
      />
      <OptionField
        label={tl('dairaOptional')}
        placeholder={wilaya === null ? tl('wilayaFirst') : tl('allDairas')}
        value={shownDaira ? dairaDisplay(shownDaira, locale) : null}
        disabled={wilaya === null || !data}
        options={data && wilaya !== null ? dairaOptions(data, wilaya, locale) : []}
        selectedIds={daira ? [daira] : []}
        emptyOption={{ label: tl('allDairas'), onPick: () => setDaira(null) }}
        onPick={setDaira}
      />
      <OptionField
        multiple
        label={tl('communes')}
        placeholder={wilaya === null ? tl('wilayaFirst') : tl('addCommunes')}
        disabled={wilaya === null || !data}
        options={options}
        selectedIds={value.map(String)}
        onPick={(id) => onChange(toggle(value, Number(id)))}
      />
      <RemovableChips
        label={tl('chosenCommunes')}
        chips={value.map((code) => ({
          key: String(code),
          label: communeDisplay(data, code, null, locale) ?? String(code),
          onRemove: () => onChange(value.filter((c) => c !== code)),
        }))}
      />
      {communes.isError ? <CommunesLoadError retry={() => void communes.refetch()} /> : null}
    </div>
  );
}
