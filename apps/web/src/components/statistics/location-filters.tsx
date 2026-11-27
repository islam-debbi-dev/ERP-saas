'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { STAT_FILTER_MAX, wilayaLabel } from '@erp/shared';
import { CommunesLoadError, wilayaOptions } from '@/components/locations/location-picker';
import { OptionField } from '@/components/locations/option-dialog';
import { RemovableChips } from '@/components/locations/removable-chips';
import { FilterChips } from '@/components/shared/filter-chips';
import type { StatsState } from '@/lib/distribution-stats';
import {
  communeDisplay,
  communeOptions,
  type CommunesModule,
  dairaDisplay,
  dairaOptions,
  wilayaValueCode,
} from '@/lib/locations';
import { useCommunes } from '@/lib/use-communes';
import { FilterGroup } from './filter-group';

export const LOCATION_FILTER_KEYS = ['clientWilayas', 'clientDairas', 'clientCommunes'] as const;
export type LocationFilterKey = (typeof LOCATION_FILTER_KEYS)[number];

type Filters = StatsState['filters'];

/**
 * The name of a filter value in the screen's language. "…" while the data loads, so that a
 * bare key or number is never shown; a value that means no place is shown as written.
 */
export function placeFilterName(
  key: LocationFilterKey,
  value: string,
  data: CommunesModule | undefined,
  locale: string,
): string {
  if (key === 'clientWilayas') {
    // A number, or the name an old link carries.
    return wilayaLabel(wilayaValueCode(value, data), locale) ?? value;
  }
  if (!data) return '…';
  if (key === 'clientDairas') {
    const daira = data.dairaByKey(value);
    return daira ? dairaDisplay(daira, locale) : value;
  }
  return communeDisplay(data, Number(value), value, locale)!;
}

/** `values` with a wilaya added, or removed in every spelling a link may have used. */
export function toggleWilaya(
  values: string[],
  code: number,
  data: CommunesModule | undefined,
): string[] {
  const others = values.filter((v) => wilayaValueCode(v, data) !== code);
  return others.length < values.length ? others : [...values, String(code)];
}

const toggled = (values: string[], value: string) =>
  values.includes(value) ? values.filter((v) => v !== value) : [...values, value];

const usesPlaces = (filters: Filters) =>
  LOCATION_FILTER_KEYS.some((k) => (filters[k]?.length ?? 0) > 0);

/** The applied place filters, on the screen: a drill-down or a shared link says what it keeps. */
export function PlaceFilterChips({
  filters,
  onChange,
}: {
  filters: Filters;
  onChange: (key: LocationFilterKey, values: string[]) => void;
}) {
  const t = useTranslations('stats');
  const locale = useLocale();
  const communes = useCommunes(usesPlaces(filters));
  const chips = LOCATION_FILTER_KEYS.flatMap((key) =>
    (filters[key] ?? []).map((value) => ({
      key: `${key}:${value}`,
      label: t('chipPlace', {
        filter: t(`filter_${key}`),
        name: placeFilterName(key, value, communes.data, locale),
      }),
      onRemove: () =>
        onChange(
          key,
          (filters[key] ?? []).filter((v) => v !== value),
        ),
    })),
  );
  return <FilterChips chips={chips} />;
}

/** Client wilaya, daïra and commune in the filter sheet. */
export function PlaceFilterGroups({
  draft,
  onChange,
}: {
  draft: Filters;
  onChange: (key: LocationFilterKey, values: string[]) => void;
}) {
  const t = useTranslations('stats');
  const tl = useTranslations('locations');
  const locale = useLocale();
  const communes = useCommunes();
  const data = communes.data;
  const wilayas = draft.clientWilayas ?? [];
  const selectedCodes = wilayas
    .map((v) => wilayaValueCode(v, data))
    .filter((c): c is number => c !== null);
  const chips = (key: LocationFilterKey) =>
    (draft[key] ?? []).map((value) => ({
      key: value,
      label: placeFilterName(key, value, data, locale),
      onRemove: () =>
        onChange(
          key,
          (draft[key] ?? []).filter((v) => v !== value),
        ),
    }));
  // One wilaya filtered: the daïra and commune lists start in it.
  const onlyWilaya = selectedCodes.length === 1 ? selectedCodes[0]! : null;

  return (
    <>
      <FilterGroup title={t('filter_clientWilayas')} count={wilayas.length}>
        <div className="space-y-2">
          <OptionField
            multiple
            label={t('filter_clientWilayas')}
            placeholder={tl('addWilayas')}
            options={wilayaOptions(locale)}
            selectedIds={selectedCodes.map(String)}
            full={wilayas.length >= STAT_FILTER_MAX}
            onPick={(id) => onChange('clientWilayas', toggleWilaya(wilayas, Number(id), data))}
          />
          <RemovableChips label={t('filter_clientWilayas')} chips={chips('clientWilayas')} />
        </div>
      </FilterGroup>
      {(['clientDairas', 'clientCommunes'] as const).map((key) => (
        <FilterGroup key={key} title={t(`filter_${key}`)} count={draft[key]?.length ?? 0}>
          <PlaceInWilaya
            filterKey={key}
            data={data}
            defaultWilaya={onlyWilaya}
            values={draft[key] ?? []}
            onToggle={(value) => onChange(key, toggled(draft[key] ?? [], value))}
          />
          <div className="mt-2">
            <RemovableChips label={t(`filter_${key}`)} chips={chips(key)} />
          </div>
        </FilterGroup>
      ))}
      {communes.isError ? <CommunesLoadError retry={() => void communes.refetch()} /> : null}
    </>
  );
}

/** Daïras or communes are too many for one list: first the wilaya to look in. */
function PlaceInWilaya({
  filterKey,
  data,
  defaultWilaya,
  values,
  onToggle,
}: {
  filterKey: 'clientDairas' | 'clientCommunes';
  data: CommunesModule | undefined;
  defaultWilaya: number | null;
  values: string[];
  onToggle: (value: string) => void;
}) {
  const t = useTranslations('stats');
  const tl = useTranslations('locations');
  const locale = useLocale();
  const [browsed, setBrowsed] = useState<number | null>(null);
  const wilaya = browsed ?? defaultWilaya;
  const dairas = filterKey === 'clientDairas';
  const options =
    !data || wilaya === null
      ? []
      : dairas
        ? dairaOptions(data, wilaya, locale)
        : communeOptions(data, wilaya, null, locale, tl('underReview'));
  return (
    <div className="space-y-2">
      <OptionField
        label={tl('inWilaya', { filter: t(`filter_${filterKey}`) })}
        placeholder={tl('chooseWilaya')}
        value={wilayaLabel(wilaya, locale)}
        options={wilayaOptions(locale)}
        selectedIds={wilaya === null ? [] : [String(wilaya)]}
        onPick={(id) => setBrowsed(Number(id))}
      />
      <OptionField
        multiple
        label={t(`filter_${filterKey}`)}
        placeholder={wilaya === null ? tl('wilayaFirst') : tl(dairas ? 'addDairas' : 'addCommunes')}
        disabled={wilaya === null || !data}
        options={options}
        selectedIds={values}
        full={values.length >= STAT_FILTER_MAX}
        onPick={onToggle}
      />
    </div>
  );
}
