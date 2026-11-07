'use client';

import { CalendarDays, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  algiersDay,
  Feature,
  type HrSettingsDto,
  LUNAR_HOLIDAY_KEYS,
  type LunarHolidayKey,
  Permission,
} from '@erp/shared';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorState } from '@/components/shared/error-state';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useFeature, usePermission } from '@/lib/auth';
import {
  useDeleteHoliday,
  useHolidays,
  useHrSettings,
  useSaveHoliday,
  useSaveHrSettings,
} from '@/lib/hr';
import { useErrorMessage } from '@/lib/use-error-message';
import { HrTabs } from './hr-tabs';

/** Friday, then the other days: the usual weekly rest comes first. */
const WEEKDAYS = [5, 6, 0, 1, 2, 3, 4] as const;

export function CalendarPage() {
  return (
    <FeatureGate feature={Feature.HR}>
      <Calendar />
    </FeatureGate>
  );
}

function Calendar() {
  const t = useTranslations('hr');
  const canManage = usePermission(Permission.HR_MANAGE);
  const settings = useHrSettings();
  return (
    <>
      <PageHeader title={t('calendarTitle')} description={t('calendarSubtitle')} />
      <HrTabs />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {settings.data ? (
          <SettingsCard settings={settings.data} canManage={canManage} />
        ) : (
          <Skeleton className="h-64 w-full" />
        )}
        <Holidays canManage={canManage} />
      </div>
    </>
  );
}

function SettingsCard({ settings, canManage }: { settings: HrSettingsDto; canManage: boolean }) {
  const t = useTranslations('hr');
  const errorMessage = useErrorMessage();
  const save = useSaveHrSettings();
  const geoOn = useFeature(Feature.GEO_CHECK);
  const [restDays, setRestDays] = useState(settings.restDays);
  const [dailyHours, setHours] = useState(String(settings.dailyHours));
  const [accrual, setAccrual] = useState(settings.leaveAccrualDays);
  const [selfCheckIn, setSelf] = useState(settings.selfCheckIn);

  const toggle = (d: number) =>
    setRestDays((v) => (v.includes(d) ? v.filter((x) => x !== d) : [...v, d]));
  const validDays = restDays.length >= 1 && restDays.length <= 2;

  const submit = () =>
    save.mutate(
      {
        restDays,
        dailyHours: Number(dailyHours),
        leaveAccrualDays: accrual,
        selfCheckIn,
      },
      {
        onSuccess: () => toast.success(t('settingsSaved')),
        onError: (err) => toast.error(errorMessage(err)),
      },
    );

  return (
    <Card className="gap-4 p-4">
      <fieldset className="space-y-2" disabled={!canManage}>
        <legend className="text-sm font-medium">{t('restDays')}</legend>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((d) => (
            <Button
              key={d}
              type="button"
              variant={restDays.includes(d) ? 'default' : 'outline'}
              className="min-h-11"
              aria-pressed={restDays.includes(d)}
              onClick={() => toggle(d)}
            >
              {t(`weekday_${d}`)}
            </Button>
          ))}
        </div>
        {!validDays ? <p className="text-sm text-destructive">{t('restDaysRule')}</p> : null}
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0 space-y-2">
          <Label htmlFor="hr-hours">{t('dailyHours')}</Label>
          <Input
            id="hr-hours"
            inputMode="numeric"
            className="h-11 text-base"
            disabled={!canManage}
            value={dailyHours}
            onChange={(e) => setHours(e.target.value)}
          />
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor="hr-accrual">{t('accrual')}</Label>
          <Input
            id="hr-accrual"
            inputMode="decimal"
            className="h-11 text-base"
            disabled={!canManage}
            value={accrual}
            onChange={(e) => setAccrual(e.target.value)}
          />
        </div>
      </div>
      {geoOn ? (
        <div className="flex min-h-11 items-center justify-between gap-3">
          <div className="min-w-0">
            <Label htmlFor="hr-self">{t('selfCheckIn')}</Label>
            <p className="text-sm text-muted-foreground">{t('selfCheckInHelp')}</p>
          </div>
          <Switch
            id="hr-self"
            disabled={!canManage}
            checked={selfCheckIn}
            onCheckedChange={setSelf}
          />
        </div>
      ) : null}
      {canManage ? (
        <Button
          className="min-h-11 self-start"
          disabled={save.isPending || !validDays}
          onClick={submit}
        >
          {t('save')}
        </Button>
      ) : null}
    </Card>
  );
}

function Holidays({ canManage }: { canManage: boolean }) {
  const t = useTranslations('hr');
  const errorMessage = useErrorMessage();
  const thisYear = Number(algiersDay().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const list = useHolidays(year);
  const add = useSaveHoliday();
  const remove = useDeleteHoliday();
  const [date, setDate] = useState('');
  const [key, setKey] = useState<LunarHolidayKey | ''>('');
  const [name, setName] = useState('');
  const missing = (list.data?.missingLunar ?? []) as LunarHolidayKey[];

  const submit = () =>
    add.mutate(
      { date, name: key ? t(`lunar_${key}`) : name.trim(), key: key || null },
      {
        onSuccess: () => {
          setDate('');
          setName('');
          setKey('');
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">{t('holidays')}</h2>
        <NativeSelect
          aria-label={t('year')}
          className="w-28"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        >
          {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </NativeSelect>
      </div>
      {missing.length > 0 ? (
        <Alert>
          <AlertDescription>
            {t('lunarReminder', {
              names: missing.map((k) => t(`lunar_${k}`)).join(', '),
            })}
          </AlertDescription>
        </Alert>
      ) : null}
      {list.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : list.isError ? (
        <ErrorState
          icon={CalendarDays}
          error={list.error}
          onRetry={() => void list.refetch()}
          className="py-6"
        />
      ) : list.data && list.data.items.length > 0 ? (
        <ul className="divide-y text-sm">
          {list.data.items.map((h) => (
            <li key={h.id} className="flex min-h-11 items-center justify-between gap-2 py-1">
              <span className="min-w-0 truncate">
                <span dir="ltr" className="num">
                  {h.date}
                </span>{' '}
                {h.name}
              </span>
              {canManage ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 shrink-0"
                  aria-label={t('deleteHoliday', { name: h.name })}
                  disabled={remove.isPending}
                  onClick={() =>
                    remove.mutate(h.id, { onError: (err) => toast.error(errorMessage(err)) })
                  }
                >
                  <Trash2 aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={CalendarDays} title={t('noHolidays')} className="py-6" />
      )}
      {canManage ? (
        <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <Label htmlFor="holiday-key">{t('holidayKind')}</Label>
            <NativeSelect
              id="holiday-key"
              value={key}
              onChange={(e) => setKey(e.target.value as LunarHolidayKey | '')}
            >
              <option value="">{t('holidayOther')}</option>
              {LUNAR_HOLIDAY_KEYS.map((k) => (
                <option key={k} value={k}>
                  {t(`lunar_${k}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="min-w-0 space-y-2">
            <Label htmlFor="holiday-date">{t('date')}</Label>
            <Input
              id="holiday-date"
              type="date"
              className="h-11 text-base"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          {!key ? (
            <div className="min-w-0 space-y-2 sm:col-span-2">
              <Label htmlFor="holiday-name">{t('holidayName')}</Label>
              <Input
                id="holiday-name"
                className="h-11 text-base"
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          ) : null}
          <Button
            className="min-h-11 sm:col-span-2 sm:justify-self-start"
            disabled={add.isPending || !date || (!key && !name.trim())}
            onClick={submit}
          >
            {t('addHoliday')}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
