'use client';

import { ArrowLeft, TriangleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  algiersDay,
  Feature,
  type PayrollRateSetDto,
  Permission,
  RATE_CONFIRMATION_TEXTS,
  RATE_TEXT_LOCALES,
  type RateTextLocale,
} from '@erp/shared';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { usePermission } from '@/lib/auth';
import { useAnswerRates, useCreateRateSet, usePayrollRates } from '@/lib/payroll';
import { useErrorMessage } from '@/lib/use-error-message';

const FIELDS = [
  'cnasEmployeeRate',
  'cnasEmployerRate',
  'abattementRate',
  'abattementMin',
  'abattementMax',
  'exemptionThreshold',
  'lissageCeiling',
  'lissageNum',
  'lissageDen',
  'lissageOffsetNum',
  'lissageOffsetDen',
  'snmg',
] as const;
type Field = (typeof FIELDS)[number];

function useRateLocale(): RateTextLocale {
  const locale = useLocale();
  return RATE_TEXT_LOCALES.find((l) => l === locale) ?? 'fr';
}

export function PayrollRatesPage() {
  return (
    <FeatureGate feature={Feature.PAYROLL}>
      <Rates />
    </FeatureGate>
  );
}

function Rates() {
  const t = useTranslations('payroll');
  const errorMessage = useErrorMessage();
  const locale = useRateLocale();
  const rates = usePayrollRates();
  const answer = useAnswerRates();
  const canManage = usePermission(Permission.PAYROLL_RATES_MANAGE);
  const [base, setBase] = useState<PayrollRateSetDto | null>(null);
  const [accepting, setAccepting] = useState<PayrollRateSetDto | null>(null);
  const data = rates.data;
  const newOfficial = data?.newOfficial ?? null;
  const latestPlatform = data?.platform[0] ?? null;

  const keep = (id: string) =>
    answer.mutate(
      { id, answer: 'keep-own', locale },
      {
        onSuccess: () => toast.success(t('ratesKept')),
        onError: (err) => toast.error(errorMessage(err)),
      },
    );

  return (
    <>
      <PageHeader
        title={t('ratesTitle')}
        description={t('ratesSubtitle')}
        more={[{ label: t('back'), icon: ArrowLeft, flipIcon: true, href: '/rh/paie' }]}
      />
      <p className="text-sm text-muted-foreground">{t('ratesResponsibility')}</p>
      {newOfficial ? (
        <Alert>
          <TriangleAlert aria-hidden />
          <AlertTitle>{t('ratesNewOfficial')}</AlertTitle>
          <AlertDescription>
            <p>{t('ratesNewOfficialHelp', { date: newOfficial.effectiveFrom })}</p>
            {canManage ? (
              <>
                <p>{RATE_CONFIRMATION_TEXTS.KEEP[locale]}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button className="min-h-11" onClick={() => setAccepting(newOfficial)}>
                    {t('ratesSwitch')}
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={answer.isPending}
                    onClick={() => keep(newOfficial.id)}
                  >
                    {t('ratesKeep')}
                  </Button>
                </div>
              </>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {rates.isPending ? <Skeleton className="h-48 w-full" /> : null}
      {data ? (
        <>
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">{t('ratesOwnTitle')}</h2>
              {canManage && latestPlatform ? (
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={() => setBase(data.own[0] ?? latestPlatform)}
                >
                  {t('ratesNewOwn')}
                </Button>
              ) : null}
            </div>
            {data.own.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('ratesOwnEmpty')}</p>
            ) : null}
            <ul className="space-y-3">
              {data.own.map((s) => (
                <li key={s.id}>
                  <SetCard set={s} />
                </li>
              ))}
            </ul>
          </section>
          <section className="space-y-3">
            <h2 className="font-semibold">{t('ratesPlatformTitle')}</h2>
            <ul className="space-y-3">
              {data.platform.map((s) => (
                <li key={s.id}>
                  <SetCard set={s} confirmed={s.confirmed}>
                    {canManage ? (
                      <div className="flex flex-wrap gap-2">
                        {s.confirmed ? null : (
                          <Button className="min-h-11" onClick={() => setAccepting(s)}>
                            {t('ratesAccept')}
                          </Button>
                        )}
                        <Button variant="outline" className="min-h-11" onClick={() => setBase(s)}>
                          {t('ratesCreateFrom')}
                        </Button>
                      </div>
                    ) : null}
                  </SetCard>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
      {accepting ? <AcceptDialog set={accepting} onClose={() => setAccepting(null)} /> : null}
      {base && latestPlatform ? (
        <OwnSetDialog base={base} platform={latestPlatform} onClose={() => setBase(null)} />
      ) : null}
    </>
  );
}

function SetCard({
  set,
  confirmed,
  children,
}: {
  set: PayrollRateSetDto;
  confirmed?: boolean;
  children?: React.ReactNode;
}) {
  const t = useTranslations('payroll');
  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{t('ratesFrom', { date: set.effectiveFrom })}</span>
        <div className="flex flex-wrap gap-1">
          {set.source === 'PLATFORM' ? (
            <Badge variant="outline">{t('ratesIndicative')}</Badge>
          ) : null}
          {confirmed ? <Badge variant="secondary">{t('ratesConfirmedBadge')}</Badge> : null}
        </div>
      </div>
      <Values set={set} />
      {set.note ? <p className="text-sm text-muted-foreground">{set.note}</p> : null}
      {children}
    </Card>
  );
}

function Values({ set }: { set: PayrollRateSetDto }) {
  const t = useTranslations('payroll');
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
      {(['cnasEmployeeRate', 'cnasEmployerRate', 'exemptionThreshold', 'snmg'] as const).map(
        (f) => (
          <div key={f} className="flex justify-between gap-2">
            <dt className="min-w-0 text-muted-foreground">{t(`rate_${f}`)}</dt>
            <dd dir="ltr" className="num">
              {set[f]}
            </dd>
          </div>
        ),
      )}
    </dl>
  );
}

function AcceptDialog({ set, onClose }: { set: PayrollRateSetDto; onClose: () => void }) {
  const t = useTranslations('payroll');
  const errorMessage = useErrorMessage();
  const locale = useRateLocale();
  const answer = useAnswerRates();
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent className="md:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('ratesAcceptTitle')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t('ratesFrom', { date: set.effectiveFrom })}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <Values set={set} />
        <p className="text-sm font-medium">{RATE_CONFIRMATION_TEXTS.ACCEPT[locale]}</p>
        <ResponsiveDialogFooter>
          <Button
            className="min-h-11"
            disabled={answer.isPending}
            onClick={() =>
              answer.mutate(
                { id: set.id, answer: 'accept', locale },
                {
                  onSuccess: () => {
                    toast.success(t('ratesAccepted'));
                    onClose();
                  },
                  onError: (err) => toast.error(errorMessage(err)),
                },
              )
            }
          >
            {t('ratesAccept')}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/** Starts from a copy, and shows the platform's value under every field. */
function OwnSetDialog({
  base,
  platform,
  onClose,
}: {
  base: PayrollRateSetDto;
  platform: PayrollRateSetDto;
  onClose: () => void;
}) {
  const t = useTranslations('payroll');
  const errorMessage = useErrorMessage();
  const locale = useRateLocale();
  const save = useCreateRateSet();
  const [effectiveFrom, setEffectiveFrom] = useState(algiersDay());
  const [values, setValues] = useState<Record<Field, string>>(
    () => Object.fromEntries(FIELDS.map((f) => [f, base[f]])) as Record<Field, string>,
  );
  const [brackets, setBrackets] = useState(base.irgBrackets);
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const setBracket = (i: number, patch: Partial<(typeof brackets)[number]>) =>
    setBrackets(brackets.map((b, n) => (n === i ? { ...b, ...patch } : b)));

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent className="md:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('ratesFormTitle')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{t('ratesFormHelp')}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rates-from">{t('ratesEffective')}</Label>
            <Input
              id="rates-from"
              type="date"
              className="h-11 text-base"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
          </div>
          {FIELDS.map((f) => (
            <div key={f} className="space-y-1">
              <Label htmlFor={`rates-${f}`}>{t(`rate_${f}`)}</Label>
              <Input
                id={`rates-${f}`}
                inputMode="decimal"
                dir="ltr"
                className="h-11 text-base"
                value={values[f]}
                onChange={(e) => setValues({ ...values, [f]: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                {t('ratesPlatformValue', { value: platform[f] })}
              </p>
            </div>
          ))}
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">{t('ratesBrackets')}</legend>
            {brackets.map((b, i) => (
              <div key={i} className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor={`rates-upto-${i}`}>
                    {b.upTo === null ? t('ratesAbove') : t('ratesUpTo')}
                  </Label>
                  <Input
                    id={`rates-upto-${i}`}
                    inputMode="decimal"
                    dir="ltr"
                    className="h-11 text-base"
                    disabled={b.upTo === null}
                    value={b.upTo ?? ''}
                    onChange={(e) => setBracket(i, { upTo: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`rates-rate-${i}`}>{t('ratesBracketRate')}</Label>
                  <Input
                    id={`rates-rate-${i}`}
                    inputMode="decimal"
                    dir="ltr"
                    className="h-11 text-base"
                    value={b.rate}
                    onChange={(e) => setBracket(i, { rate: e.target.value })}
                  />
                  {platform.irgBrackets[i] ? (
                    <p className="text-xs text-muted-foreground">
                      {t('ratesPlatformValue', { value: platform.irgBrackets[i].rate })}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
          </fieldset>
          <div className="space-y-2">
            <Label htmlFor="rates-note">{t('ratesNote')}</Label>
            <Input
              id="rates-note"
              className="h-11 text-base"
              maxLength={255}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div className="flex min-h-11 items-center justify-between gap-3">
            <Label htmlFor="rates-confirm">{RATE_CONFIRMATION_TEXTS.OWN[locale]}</Label>
            <Switch id="rates-confirm" checked={confirmed} onCheckedChange={setConfirmed} />
          </div>
        </div>
        <ResponsiveDialogFooter>
          <Button
            className="min-h-11"
            disabled={save.isPending || !confirmed || !effectiveFrom}
            onClick={() =>
              save.mutate(
                {
                  ...values,
                  effectiveFrom,
                  irgBrackets: brackets,
                  note: note.trim() || null,
                  locale,
                  confirmed: true,
                },
                {
                  onSuccess: () => {
                    toast.success(t('ratesSaved'));
                    onClose();
                  },
                  onError: (err) => toast.error(errorMessage(err)),
                },
              )
            }
          >
            {t('ratesSave')}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
