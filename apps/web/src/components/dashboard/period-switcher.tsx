'use client';

import { CalendarRange } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import {
  DASHBOARD_PERIODS,
  type DashboardPeriod,
  type DashboardPeriodRange,
  MAX_REPORT_DAYS,
  rangeLength,
} from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import type { DashboardPeriodQuery } from '@/lib/reports';
import { cn } from '@/lib/utils';

/** "Du 1 nov. au 10 nov.", or one day. */
export function usePeriodSpan() {
  const t = useTranslations('dashboard');
  const format = useFormatter();
  const day = (iso: string) =>
    format.dateTime(new Date(`${iso}T12:00:00Z`), { day: 'numeric', month: 'short' });
  return (r: { from: string; to: string }) =>
    r.from === r.to ? day(r.from) : t('periodSpan', { from: day(r.from), to: day(r.to) });
}

/** The name of the period on the cards: a preset's name, or its dates. */
export function usePeriodName() {
  const t = useTranslations('dashboard');
  const span = usePeriodSpan();
  return (r: DashboardPeriodRange) => (r.period === 'custom' ? span(r) : t(`period_${r.period}`));
}

/**
 * Aujourd'hui · 7 jours · Ce mois · Mois dernier · Personnalisé (phase 33). Wraps on a
 * phone instead of scrolling sideways; the custom dates open in a dialog.
 */
export function PeriodSwitcher({
  value,
  range,
  onChange,
}: {
  value: DashboardPeriodQuery;
  /** The days the API resolved, to start the custom dialog from them. */
  range: DashboardPeriodRange | undefined;
  onChange: (next: DashboardPeriodQuery) => void;
}) {
  const t = useTranslations('dashboard');
  const span = usePeriodSpan();
  const [open, setOpen] = useState(false);
  const pick = (p: DashboardPeriod) => {
    if (p === 'custom') setOpen(true);
    else onChange({ period: p, from: '', to: '' });
  };
  return (
    <div className="space-y-1">
      <div
        role="group"
        aria-label={t('periodLabel')}
        className="flex flex-wrap gap-1 rounded-lg border bg-card p-1"
      >
        {DASHBOARD_PERIODS.map((p) => {
          const active = value.period === p;
          return (
            <button
              key={p}
              type="button"
              aria-pressed={active}
              onClick={() => pick(p)}
              className={cn(
                'inline-flex min-h-11 grow items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:grow-0',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground active:bg-muted',
              )}
            >
              {p === 'custom' ? <CalendarRange className="size-4" aria-hidden /> : null}
              {p === 'custom' && active && range ? span(range) : t(`period_${p}`)}
            </button>
          );
        })}
      </div>
      {open ? (
        <CustomDialog
          initial={range ?? { from: '', to: '' }}
          onClose={() => setOpen(false)}
          onApply={(r) => {
            setOpen(false);
            onChange({ period: 'custom', ...r });
          }}
        />
      ) : null}
    </div>
  );
}

function CustomDialog({
  initial,
  onClose,
  onApply,
}: {
  initial: { from: string; to: string };
  onClose: () => void;
  onApply: (r: { from: string; to: string }) => void;
}) {
  const t = useTranslations('dashboard');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const valid =
    from !== '' && to !== '' && from <= to && rangeLength({ from, to }) <= MAX_REPORT_DAYS;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) onApply({ from, to });
  };
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent className="md:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t('periodCustomTitle')}</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="dash-from">{t('periodFrom')}</Label>
              <Input
                id="dash-from"
                type="date"
                dir="ltr"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dash-to">{t('periodTo')}</Label>
              <Input
                id="dash-to"
                type="date"
                dir="ltr"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>
          {from && to && !valid ? (
            <p role="alert" className="text-sm text-destructive">
              {t('periodInvalid')}
            </p>
          ) : null}
          <ResponsiveDialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('periodCancel')}
            </Button>
            <Button type="submit" disabled={!valid}>
              {t('periodApply')}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
