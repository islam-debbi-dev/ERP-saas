'use client';

import { Info, RotateCcw, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { WILAYAS, wilayaLabel } from '@erp/shared';
import { Button } from '@/components/ui/button';
import {
  communeDisplay,
  communeOptions,
  dairaDisplay,
  dairaOptions,
  type LocationOption,
  type PlaceSelection,
  type SectorSelection,
} from '@/lib/locations';
import { useCommunes } from '@/lib/use-communes';
import { OptionField } from './option-dialog';
import { RemovableChips } from './removable-chips';

/** The 69 wilayas by number; they are in the main bundle already. */
export function wilayaOptions(locale: string): LocationOption[] {
  return WILAYAS.map((w) => ({
    id: String(w.code),
    label: wilayaLabel(w.code, locale)!,
    keywords: [w.fr, w.ar, String(w.code), String(w.code).padStart(2, '0')],
  }));
}

/** The data for the daïra and commune lists, with a way back when it did not load. */
export function CommunesLoadError({ retry }: { retry: () => void }) {
  const t = useTranslations('locations');
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
      <span>{t('loadError')}</span>
      <Button type="button" variant="outline" className="min-h-11" onClick={retry}>
        {t('retry')}
      </Button>
    </div>
  );
}

/** Typed text without a code yet, so that the user can choose the same place in the list. */
function OldTextNote({ text, cleared }: { text: string; cleared: boolean }) {
  const t = useTranslations('locations');
  if (!text) return null;
  return (
    <p className="flex items-start gap-2 rounded-md border bg-muted/50 p-3 text-sm">
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">
        {t.rich(cleared ? 'oldTextRemoved' : 'oldText', {
          text,
          bdi: (chunks: ReactNode) => <bdi className="font-medium">{chunks}</bdi>,
        })}
      </span>
    </p>
  );
}

/** "Clear" empties the choice; "undo" puts back what is saved. */
function PlaceActions({ onClear, onUndo }: { onClear?: () => void; onUndo?: () => void }) {
  const t = useTranslations('locations');
  if (!onClear && !onUndo) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {onUndo ? (
        <Button type="button" variant="outline" className="min-h-11" onClick={onUndo}>
          <RotateCcw className="rtl-flip" aria-hidden />
          {t('undo')}
        </Button>
      ) : null}
      {onClear ? (
        <Button type="button" variant="ghost" className="min-h-11" onClick={onClear}>
          <X aria-hidden />
          {t('clear')}
        </Button>
      ) : null}
    </div>
  );
}

interface PickerProps<T> {
  /** What is chosen: the user's choice, or what is saved while untouched. */
  value: T;
  /** True once the user changed it. */
  touched: boolean;
  onChange: (next: T) => void;
  /** Back to untouched. */
  onUndo: () => void;
  /** Typed text without a code; '' when none. */
  oldText: string;
}

/**
 * Wilaya, then daïra (optional, only narrows the list), then commune. Changing the wilaya
 * empties the two below.
 */
export function LocationPicker({
  value,
  touched,
  onChange,
  onUndo,
  oldText,
}: PickerProps<PlaceSelection>) {
  const t = useTranslations('locations');
  const locale = useLocale();
  const communes = useCommunes();
  const data = communes.data;
  // Only a filter of the list: it is never saved.
  const [daira, setDaira] = useState<string | null>(null);
  const { wilayaCode, communeCode } = value;
  const picked = data?.communeByCode(communeCode);
  const shownDaira = data?.dairaByKey(daira ?? picked?.dairaKey);

  return (
    <div role="group" aria-label={t('group')} className="grid min-w-0 gap-4 sm:col-span-2">
      <OldTextNote text={oldText} cleared={touched && wilayaCode === null} />
      <div className="grid min-w-0 gap-4 sm:grid-cols-3">
        <OptionField
          label={t('wilaya')}
          placeholder={t('chooseWilaya')}
          value={wilayaLabel(wilayaCode, locale)}
          options={wilayaOptions(locale)}
          selectedIds={wilayaCode === null ? [] : [String(wilayaCode)]}
          onPick={(id) => {
            if (Number(id) === wilayaCode) return;
            setDaira(null);
            onChange({ wilayaCode: Number(id), communeCode: null });
          }}
        />
        <OptionField
          label={t('dairaOptional')}
          placeholder={wilayaCode === null ? t('wilayaFirst') : t('allDairas')}
          value={shownDaira ? dairaDisplay(shownDaira, locale) : null}
          disabled={wilayaCode === null || !data}
          options={data && wilayaCode !== null ? dairaOptions(data, wilayaCode, locale) : []}
          selectedIds={shownDaira ? [shownDaira.key] : []}
          emptyOption={{
            label: t('allDairas'),
            onPick: () => setDaira(null),
          }}
          onPick={(key) => {
            setDaira(key);
            if (picked && picked.dairaKey !== key) onChange({ wilayaCode, communeCode: null });
          }}
        />
        <OptionField
          label={t('commune')}
          placeholder={
            wilayaCode === null
              ? t('wilayaFirst')
              : communes.isPending
                ? t('loading')
                : t('chooseCommune')
          }
          value={communeDisplay(data, communeCode, null, locale)}
          disabled={wilayaCode === null || !data}
          options={
            data && wilayaCode !== null
              ? // A chosen commune without a daïra filter must stay listed.
                communeOptions(data, wilayaCode, daira, locale, t('underReview'))
              : []
          }
          selectedIds={communeCode === null ? [] : [String(communeCode)]}
          emptyOption={
            communeCode === null
              ? undefined
              : { label: t('noCommune'), onPick: () => onChange({ wilayaCode, communeCode: null }) }
          }
          onPick={(id) => onChange({ wilayaCode, communeCode: Number(id) })}
        />
      </div>
      {communes.isError ? <CommunesLoadError retry={() => void communes.refetch()} /> : null}
      <PlaceActions
        onUndo={touched ? onUndo : undefined}
        onClear={
          wilayaCode === null
            ? undefined
            : () => {
                setDaira(null);
                onChange({ wilayaCode: null, communeCode: null });
              }
        }
      />
    </div>
  );
}

/** The same for a sector: several communes of one wilaya, as removable chips. */
export function SectorLocationPicker({
  value,
  touched,
  onChange,
  onUndo,
  oldText,
  storedNames,
}: PickerProps<SectorSelection> & {
  /** Stored text names by code, shown while the data loads. */
  storedNames: Map<number, string>;
}) {
  const t = useTranslations('locations');
  const locale = useLocale();
  const communes = useCommunes();
  const data = communes.data;
  const [daira, setDaira] = useState<string | null>(null);
  const { wilayaCode, communeCodes } = value;
  const shownDaira = data?.dairaByKey(daira);
  const name = (code: number) =>
    communeDisplay(data, code, storedNames.get(code) ?? null, locale) ?? String(code);

  return (
    <div role="group" aria-label={t('group')} className="grid min-w-0 gap-4">
      <OldTextNote text={oldText} cleared={touched && wilayaCode === null} />
      <OptionField
        label={t('wilaya')}
        placeholder={t('chooseWilaya')}
        value={wilayaLabel(wilayaCode, locale)}
        options={wilayaOptions(locale)}
        selectedIds={wilayaCode === null ? [] : [String(wilayaCode)]}
        onPick={(id) => {
          if (Number(id) === wilayaCode) return;
          setDaira(null);
          onChange({ wilayaCode: Number(id), communeCodes: [] });
        }}
      />
      <OptionField
        label={t('dairaOptional')}
        placeholder={wilayaCode === null ? t('wilayaFirst') : t('allDairas')}
        value={shownDaira ? dairaDisplay(shownDaira, locale) : null}
        disabled={wilayaCode === null || !data}
        options={data && wilayaCode !== null ? dairaOptions(data, wilayaCode, locale) : []}
        selectedIds={daira ? [daira] : []}
        emptyOption={{ label: t('allDairas'), onPick: () => setDaira(null) }}
        // Only narrows the commune list: the chosen communes stay.
        onPick={setDaira}
      />
      <OptionField
        multiple
        label={t('communes')}
        placeholder={
          wilayaCode === null
            ? t('wilayaFirst')
            : communes.isPending
              ? t('loading')
              : t('addCommunes')
        }
        disabled={wilayaCode === null || !data}
        options={
          data && wilayaCode !== null
            ? communeOptions(data, wilayaCode, daira, locale, t('underReview'))
            : []
        }
        selectedIds={communeCodes.map(String)}
        full={communeCodes.length >= 100}
        onPick={(id) => {
          const code = Number(id);
          onChange({
            wilayaCode,
            communeCodes: communeCodes.includes(code)
              ? communeCodes.filter((c) => c !== code)
              : [...communeCodes, code],
          });
        }}
      />
      <RemovableChips
        label={t('chosenCommunes')}
        chips={communeCodes.map((code) => ({
          key: String(code),
          label: name(code),
          onRemove: () =>
            onChange({ wilayaCode, communeCodes: communeCodes.filter((c) => c !== code) }),
        }))}
      />
      {communes.isError ? <CommunesLoadError retry={() => void communes.refetch()} /> : null}
      <PlaceActions
        onUndo={touched ? onUndo : undefined}
        onClear={
          wilayaCode === null
            ? undefined
            : () => {
                setDaira(null);
                onChange({ wilayaCode: null, communeCodes: [] });
              }
        }
      />
    </div>
  );
}
