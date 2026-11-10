'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Banknote,
  CircleCheck,
  ClipboardList,
  List,
  Loader2,
  Map as MapIcon,
  MapPinned,
  Phone,
  ReceiptText,
  UserX,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  type CreateVisitInput,
  Feature,
  NO_SALE_REASONS,
  type NoSaleReason,
  type OrderDto,
  type TodayStopDto,
  type VisitDto,
  type VisitOutcome,
} from '@erp/shared';
import { BalanceAmount } from '@/components/clients/balance-amount';
import { GeoPrivacyNotice, isGeoCancelled, useGeoSubmit } from '@/components/geo/use-geo-submit';
import { PaymentDialog } from '@/components/payments/payment-dialog';
import { Amount } from '@/components/shared/amount';
import { EmptyState } from '@/components/shared/empty-state';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api-client';
import { useFeature } from '@/lib/auth';
import { useClient } from '@/lib/clients';
import { tourneeKeys, useToday } from '@/lib/tournees';
import { useErrorMessage } from '@/lib/use-error-message';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';
import { cn } from '@/lib/utils';
import { TodayMap } from './today-map';
import { useWeekdayLabels } from './weekdays';

/** Tournée du jour (phase 16): the seller's stops of today, on his phone. */
export function TodayScreen() {
  return (
    <FeatureGate feature={Feature.TOURNEES}>
      <Today />
    </FeatureGate>
  );
}

function Today() {
  const t = useTranslations('tournees');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const today = useToday();
  const dayName = useWeekdayLabels('long');
  const [visiting, setVisiting] = useState<TodayStopDto | null>(null);
  const [paying, setPaying] = useState<string | null>(null);
  const day = today.data;
  // Phase 35: the day on a map (stops have points with GEO_CHECK).
  const geo = useFeature(Feature.GEO_CHECK);
  const [view, setView] = useState<'list' | 'map'>('list');
  const showMap = geo && view === 'map';

  return (
    <>
      <PageHeader
        title={t('todayTitle')}
        description={
          day
            ? `${dayName(day.weekday)} ${format.dateTime(new Date(`${day.day}T12:00:00Z`), { dateStyle: 'long' })}`
            : undefined
        }
        actions={
          geo ? (
            <div
              role="radiogroup"
              aria-label={t('viewLabel')}
              className="flex rounded-md border p-0.5"
            >
              {(['list', 'map'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={view === v}
                  onClick={() => setView(v)}
                  className={cn(
                    'inline-flex h-10 min-w-11 items-center gap-1.5 rounded px-3 text-sm font-medium',
                    view === v ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                  )}
                >
                  {v === 'list' ? (
                    <List className="size-4" aria-hidden />
                  ) : (
                    <MapIcon className="size-4" aria-hidden />
                  )}
                  {v === 'list' ? t('viewList') : t('viewMap')}
                </button>
              ))}
            </div>
          ) : undefined
        }
      />

      {day && day.planned > 0 ? (
        <div className="space-y-2" role="status">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">
              {t('progress', { visited: day.visited, planned: day.planned })}
            </span>
            <span className="text-muted-foreground">
              {day.routes.map((r) => r.name).join(', ')}
            </span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label={t('progressLabel')}
            aria-valuemin={0}
            aria-valuemax={day.planned}
            aria-valuenow={day.visited}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${(100 * day.visited) / day.planned}%` }}
            />
          </div>
        </div>
      ) : null}

      {today.isPending ? (
        <div className="space-y-3" aria-busy>
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : today.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(today.error)}
        </p>
      ) : !day || day.stops.length === 0 ? (
        <Card>
          <EmptyState
            icon={MapPinned}
            title={t('todayEmptyTitle')}
            description={t('todayEmptyDescription')}
          />
        </Card>
      ) : showMap ? (
        <TodayMap stops={day.stops} onVisit={setVisiting} />
      ) : (
        <ol className="space-y-3">
          {day.stops.map((s, i) => (
            <li key={s.client.id}>
              <StopCard
                stop={s}
                index={i + 1}
                onVisit={() => setVisiting(s)}
                onPay={() => setPaying(s.client.id)}
              />
            </li>
          ))}
        </ol>
      )}

      {/* Remounted per stop: the visit starts when its sheet opens. */}
      <VisitDialog
        key={visiting?.client.id ?? 'none'}
        stop={visiting}
        onClose={() => setVisiting(null)}
      />
      {paying ? <PayFor clientId={paying} onClose={() => setPaying(null)} /> : null}
    </>
  );
}

function StopCard({
  stop,
  index,
  onVisit,
  onPay,
}: {
  stop: TodayStopDto;
  index: number;
  onVisit: () => void;
  onPay: () => void;
}) {
  const t = useTranslations('tournees');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const key = useIdempotencyKey(true);
  const order = useMutation({
    mutationFn: () =>
      api.request<OrderDto>('/orders', {
        method: 'POST',
        body: { clientId: stop.client.id, lines: [] },
        idempotencyKey: key,
      }),
    onSuccess: (o) => router.push(`/commandes/${o.id}`),
    onError: (err) => toast.error(errorMessage(err)),
  });
  const last = stop.lastVisit;

  return (
    <Card className={cn('gap-3 p-4', stop.visitedToday && 'border-primary/40 bg-primary/5')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span
            className="num flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium"
            aria-hidden
          >
            {index}
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold" title={stop.client.name}>
              {stop.client.name}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {[stop.client.commune, stop.client.address].filter(Boolean).join(' · ') ||
                stop.client.code}
            </p>
          </div>
        </div>
        <BalanceAmount value={stop.balance} className="shrink-0 text-end text-sm" />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {stop.visitedToday ? (
          <Badge variant="secondary" className="gap-1">
            <CircleCheck className="size-3.5" aria-hidden />
            {t('visitedToday')}
          </Badge>
        ) : null}
        {last ? (
          <span>
            {t('lastVisit', {
              date: format.dateTime(new Date(last.startedAt), { dateStyle: 'short' }),
              outcome: last.reason ? t(`reason${last.reason}`) : t(`outcome${last.outcome}`),
            })}
          </span>
        ) : (
          <span>{t('neverVisited')}</span>
        )}
        {stop.lastSale ? (
          <span>
            {t('lastSale', {
              date: format.dateTime(new Date(stop.lastSale.validatedAt), { dateStyle: 'short' }),
            })}{' '}
            <Amount value={stop.lastSale.totalTtc} />
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Button asChild variant="outline">
          <Link href={`/ventes/nouvelle?client=${stop.client.id}`}>
            <ReceiptText aria-hidden />
            {t('actionSale')}
          </Link>
        </Button>
        <Button variant="outline" disabled={order.isPending} onClick={() => order.mutate()}>
          {order.isPending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <ClipboardList aria-hidden />
          )}
          {t('actionOrder')}
        </Button>
        <Button variant="outline" onClick={onPay}>
          <Banknote aria-hidden />
          {t('actionPayment')}
        </Button>
        <Button onClick={onVisit}>
          <CircleCheck aria-hidden />
          {t('actionVisit')}
        </Button>
      </div>
      {stop.client.phone ? (
        <a
          href={`tel:${stop.client.phone}`}
          className="inline-flex min-h-11 items-center gap-2 self-start text-sm text-primary underline-offset-4 hover:underline"
        >
          <Phone className="size-4" aria-hidden />
          <span dir="ltr">{stop.client.phone}</span>
        </a>
      ) : null}
    </Card>
  );
}

/** The versement dialog needs the full client. */
function PayFor({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const client = useClient(clientId);
  if (!client.data) return null;
  return (
    <PaymentDialog
      open
      client={client.data}
      onOpenChange={(open) => {
        if (open) return;
        void queryClient.invalidateQueries({ queryKey: tourneeKeys.today });
        onClose();
      }}
    />
  );
}

/**
 * Ends a stop. A sale, an order or a versement made today is linked to the visit (the
 * API needs the document behind a productive outcome); otherwise, why there was none.
 */
function VisitDialog({ stop, onClose }: { stop: TodayStopDto | null; onClose: () => void }) {
  const t = useTranslations('tournees');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const open = stop !== null;
  const key = useIdempotencyKey(open);
  const [outcome, setOutcome] = useState<VisitOutcome | null>(null);
  const [reason, setReason] = useState<NoSaleReason | null>(null);
  const [note, setNote] = useState('');
  const [startedAt] = useState(() => new Date().toISOString());

  const docs = stop?.today;
  const choices: { outcome: VisitOutcome; available: boolean }[] = [
    { outcome: 'SALE', available: !!docs?.saleId },
    { outcome: 'ORDER', available: !!docs?.orderId },
    { outcome: 'PAYMENT_ONLY', available: !!docs?.paymentId },
    { outcome: 'NO_SALE', available: true },
  ];
  // The most useful outcome is picked first: what the seller just did.
  const current =
    outcome ?? choices.find((c) => c.available && c.outcome !== 'NO_SALE')?.outcome ?? 'NO_SALE';

  const reset = () => {
    setOutcome(null);
    setReason(null);
    setNote('');
  };

  const geo = useGeoSubmit();
  const save = useMutation({
    mutationFn: () => {
      if (!stop) throw new Error('no stop');
      const body: Partial<CreateVisitInput> = {
        clientId: stop.client.id,
        routeId: stop.routeId,
        startedAt,
        endedAt: new Date().toISOString(),
        outcome: current,
        reason: current === 'NO_SALE' ? reason : null,
        note: note.trim() || null,
        saleId: current === 'SALE' ? (docs?.saleId ?? null) : null,
        orderId: current === 'ORDER' ? (docs?.orderId ?? null) : null,
        paymentId: current === 'PAYMENT_ONLY' ? (docs?.paymentId ?? null) : null,
      };
      // Phase 17: the seller's position goes with the visit (a note if asked).
      return geo.run((g) =>
        api.request<VisitDto>('/visits', {
          method: 'POST',
          body: g ? { ...body, geo: g } : body,
          idempotencyKey: key,
        }),
      );
    },
    onSuccess: (v) => {
      geo.after(v.geoCheck, v.client.id);
      void queryClient.invalidateQueries({ queryKey: tourneeKeys.today });
      toast.success(t('visitSaved'));
      reset();
      onClose();
    },
    onError: (err) => {
      if (!isGeoCancelled(err)) toast.error(errorMessage(err));
    },
  });

  const valid =
    current !== 'NO_SALE' || (reason !== null && (reason !== 'OTHER' || note.trim().length > 0));

  return (
    <>
      <ResponsiveDialog
        open={open}
        onOpenChange={(o) => {
          if (!o) {
            reset();
            onClose();
          }
        }}
      >
        <ResponsiveDialogContent className="md:max-w-md">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) save.mutate();
            }}
          >
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>
                {t('visitTitle', { name: stop?.client.name ?? '' })}
              </ResponsiveDialogTitle>
              <ResponsiveDialogDescription>{t('visitHelp')}</ResponsiveDialogDescription>
            </ResponsiveDialogHeader>

            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-medium">{t('outcome')}</legend>
              {choices.map((c) => (
                <label
                  key={c.outcome}
                  className={cn(
                    'flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm',
                    current === c.outcome && 'border-primary bg-primary/5',
                    !c.available && 'cursor-not-allowed opacity-60',
                  )}
                >
                  <input
                    type="radio"
                    name="visit-outcome"
                    className="size-4 accent-[var(--primary)]"
                    checked={current === c.outcome}
                    disabled={!c.available}
                    onChange={() => setOutcome(c.outcome)}
                  />
                  <span className="flex-1">{t(`outcome${c.outcome}`)}</span>
                  {!c.available ? (
                    <span className="text-xs text-muted-foreground">{t('noDocumentToday')}</span>
                  ) : null}
                </label>
              ))}
            </fieldset>

            {current === 'NO_SALE' ? (
              <fieldset className="grid gap-2">
                <legend className="mb-2 text-sm font-medium">{t('reason')}</legend>
                <div className="grid grid-cols-2 gap-2">
                  {NO_SALE_REASONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      aria-pressed={reason === r}
                      onClick={() => setReason(r)}
                      className={cn(
                        'flex min-h-11 items-center justify-center gap-2 rounded-md border px-2 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                        reason === r
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'bg-background hover:bg-muted',
                      )}
                    >
                      {r === 'CLOSED' ? <UserX className="size-4" aria-hidden /> : null}
                      {t(`reason${r}`)}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="visit-note">
                {t('note')}
                {current === 'NO_SALE' && reason === 'OTHER' ? null : (
                  <span className="font-normal text-muted-foreground">({tc('optional')})</span>
                )}
              </Label>
              <Textarea
                id="visit-note"
                rows={2}
                maxLength={255}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            {geo.on ? <GeoPrivacyNotice /> : null}

            <ResponsiveDialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                {tc('cancel')}
              </Button>
              <Button type="submit" disabled={!valid || save.isPending}>
                {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {t('saveVisit')}
              </Button>
            </ResponsiveDialogFooter>
          </form>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
      {geo.dialog}
    </>
  );
}
