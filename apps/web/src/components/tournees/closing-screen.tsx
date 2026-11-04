'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, HandCoins, Loader2, NotebookPen, Truck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  algiersDay,
  Feature,
  money,
  parseDA,
  type SellerDayDto,
  type SellerSessionCloseResultDto,
  type SellerSessionDto,
  type StockTransferDto,
  type VehicleStockLineDto,
} from '@erp/shared';
import { Amount } from '@/components/shared/amount';
import { EmptyState } from '@/components/shared/empty-state';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
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
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api-client';
import { useFeature } from '@/lib/auth';
import { formatQty, stockKeys, useWarehouses } from '@/lib/stock';
import { tourneeKeys, useSellerDays } from '@/lib/tournees';
import { useErrorMessage } from '@/lib/use-error-message';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';
import { cn } from '@/lib/utils';

/** Clôture de tournée (phase 16): the cash each seller must hand over, and what he did. */
export function ClosingScreen() {
  return (
    <FeatureGate feature={Feature.TOURNEES}>
      <Closing />
    </FeatureGate>
  );
}

/** An écart: red with a minus when cash is missing, never colour alone. */
function Ecart({ value }: { value: string }) {
  const t = useTranslations('tournees');
  const v = money(value);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-semibold',
        v.lt(0) && 'text-destructive',
        v.gt(0) && 'text-emerald-700 dark:text-emerald-400',
      )}
    >
      {v.lt(0) ? t('ecartMissing') : v.gt(0) ? t('ecartExtra') : t('ecartNone')}
      {!v.isZero() ? <Amount value={v.abs().toString()} /> : null}
    </span>
  );
}

function Closing() {
  const t = useTranslations('tournees');
  const errorMessage = useErrorMessage();
  const [date, setDate] = useState(() => algiersDay());
  const days = useSellerDays(date);
  const [closing, setClosing] = useState<SellerDayDto | null>(null);
  const [adjusting, setAdjusting] = useState<SellerSessionDto | null>(null);
  const [leftover, setLeftover] = useState<{
    vehicleId: string;
    lines: VehicleStockLineDto[];
  } | null>(null);
  const list = days.data ?? [];

  return (
    <>
      <PageHeader
        title={t('closingTitle')}
        description={t('closingSubtitle')}
        more={[
          { label: t('back'), icon: ArrowLeft, flipIcon: true, tone: 'ghost', href: '/tournees' },
        ]}
      />

      <div className="max-w-xs space-y-2">
        <Label htmlFor="closing-date">{t('day')}</Label>
        <Input
          id="closing-date"
          type="date"
          value={date}
          max={algiersDay()}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
      </div>

      {days.isPending ? (
        <div className="space-y-3" aria-busy>
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : days.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(days.error)}
        </p>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={HandCoins}
            title={t('closingEmptyTitle')}
            description={t('closingEmptyDescription')}
          />
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {list.map((d) => (
            <li key={d.seller.id}>
              <SellerDayCard
                day={d}
                onClose={() => setClosing(d)}
                onAdjust={() => d.session && setAdjusting(d.session)}
              />
            </li>
          ))}
        </ul>
      )}

      <CloseDialog
        key={closing?.seller.id ?? 'none'}
        day={closing}
        onClose={() => setClosing(null)}
        onClosed={(res) => {
          const vehicle = closing?.vehicle;
          setClosing(null);
          if (vehicle && res.vehicleStock.length > 0) {
            setLeftover({ vehicleId: vehicle.id, lines: res.vehicleStock });
          }
        }}
      />
      <AdjustDialog
        key={adjusting?.id ?? 'none'}
        session={adjusting}
        onClose={() => setAdjusting(null)}
      />
      <UnloadDialog
        key={leftover?.vehicleId ?? 'none'}
        leftover={leftover}
        onClose={() => setLeftover(null)}
      />
    </>
  );
}

function SellerDayCard({
  day,
  onClose,
  onAdjust,
}: {
  day: SellerDayDto;
  onClose: () => void;
  onAdjust: () => void;
}) {
  const t = useTranslations('tournees');
  const format = useFormatter();
  const s = day.session;
  const closed = s?.status === 'CLOSED';
  const expected = closed ? s.expected : day.expected;
  // A later count (adjustment) replaces the handed cash and the écart.
  const recount = [...(s?.adjustments ?? [])].reverse().find((a) => a.ecart !== null);

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{day.seller.fullName}</p>
          {day.vehicle ? (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Truck className="size-3.5" aria-hidden />
              {day.vehicle.name}
            </p>
          ) : null}
        </div>
        <Badge variant={closed ? 'secondary' : 'outline'}>
          {closed ? t('sessionClosed') : t('sessionOpen')}
        </Badge>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{t('cashFromSales')}</dt>
        <dd className="text-end">
          <Amount value={expected.fromSales} />
        </dd>
        <dt className="text-muted-foreground">{t('cashFromVersements')}</dt>
        <dd className="text-end">
          <Amount value={expected.fromVersements} />
        </dd>
        <dt className="font-medium">{t('expectedCash')}</dt>
        <dd className="text-end font-semibold">
          <Amount value={expected.total} />
        </dd>
        {closed && s.handedCash !== null ? (
          <>
            <dt className="text-muted-foreground">{t('handedCash')}</dt>
            <dd className="text-end">
              <Amount value={recount?.handedCash ?? s.handedCash} />
            </dd>
            <dt className="text-muted-foreground">{t('ecart')}</dt>
            <dd className="text-end">
              <Ecart value={recount?.ecart ?? s.ecart ?? '0'} />
            </dd>
          </>
        ) : null}
      </dl>

      {closed && s.closedAt ? (
        <p className="text-xs text-muted-foreground">
          {t('closedByAt', {
            name: s.closedBy?.fullName ?? '',
            time: format.dateTime(new Date(s.closedAt), { timeStyle: 'short' }),
          })}
          {s.adjustments.length > 0
            ? ` · ${t('adjustmentCount', { count: s.adjustments.length })}`
            : ''}
        </p>
      ) : null}

      {closed ? (
        <Button variant="outline" onClick={onAdjust}>
          <NotebookPen aria-hidden />
          {t('adjust')}
        </Button>
      ) : (
        <Button onClick={onClose}>
          <HandCoins aria-hidden />
          {t('closeDay')}
        </Button>
      )}
    </Card>
  );
}

function CloseDialog({
  day,
  onClose,
  onClosed,
}: {
  day: SellerDayDto | null;
  onClose: () => void;
  onClosed: (res: SellerSessionCloseResultDto) => void;
}) {
  const t = useTranslations('tournees');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const open = day !== null;
  const openKey = useIdempotencyKey(open);
  const closeKey = useIdempotencyKey(open);
  const [handed, setHanded] = useState('');
  const [note, setNote] = useState('');
  const value = parseDA(handed);
  const ecart = day && value ? value.minus(day.expected.total) : null;

  const close = useMutation({
    mutationFn: async () => {
      if (!day || !value) throw new Error('nothing to close');
      // Opening is safe to repeat: the same day gives the same session.
      const session =
        day.session ??
        (await api.request<SellerSessionDto>('/seller-sessions', {
          method: 'POST',
          body: { sellerId: day.seller.id, date: day.date },
          idempotencyKey: openKey,
        }));
      return api.request<SellerSessionCloseResultDto>(`/seller-sessions/${session.id}/close`, {
        method: 'POST',
        body: { handedCash: value.toString(), note: note.trim() || null },
        idempotencyKey: closeKey,
      });
    },
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: tourneeKeys.allSessions });
      toast.success(t('dayClosed'));
      onClosed(res);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent className="md:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (value) close.mutate();
          }}
        >
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {t('closeTitle', { name: day?.seller.fullName ?? '' })}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>{t('closeHelp')}</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="flex items-baseline justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
            <span>{t('expectedCash')}</span>
            <Amount value={day?.expected.total ?? '0'} className="font-semibold" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="close-handed">{t('handedCash')}</Label>
            <Input
              id="close-handed"
              dir="ltr"
              inputMode="decimal"
              className="num"
              autoFocus
              value={handed}
              aria-invalid={handed !== '' && !value}
              onChange={(e) => setHanded(e.target.value)}
            />
          </div>
          {ecart ? (
            <p className="text-sm" role="status">
              {t('ecart')} : <Ecart value={ecart.toString()} />
            </p>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="close-note">
              {t('note')}{' '}
              <span className="font-normal text-muted-foreground">({tc('optional')})</span>
            </Label>
            <Textarea
              id="close-note"
              rows={2}
              maxLength={255}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">{t('closeFinal')}</p>
          <ResponsiveDialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={!value || close.isPending}>
              {close.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t('closeDay')}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function AdjustDialog({
  session,
  onClose,
}: {
  session: SellerSessionDto | null;
  onClose: () => void;
}) {
  const t = useTranslations('tournees');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const open = session !== null;
  const key = useIdempotencyKey(open);
  const [handed, setHanded] = useState('');
  const [note, setNote] = useState('');
  const value = handed.trim() === '' ? null : parseDA(handed);

  const adjust = useMutation({
    mutationFn: () =>
      api.request<SellerSessionDto>(`/seller-sessions/${session?.id ?? ''}/adjust`, {
        method: 'POST',
        body: { handedCash: value?.toString() ?? null, note: note.trim() },
        idempotencyKey: key,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tourneeKeys.allSessions });
      toast.success(t('adjusted'));
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const valid = note.trim().length >= 3 && (handed.trim() === '' || value !== null);

  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent className="md:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) adjust.mutate();
          }}
        >
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t('adjustTitle')}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>{t('adjustHelp')}</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="adjust-handed">
              {t('countedAgain')}{' '}
              <span className="font-normal text-muted-foreground">({tc('optional')})</span>
            </Label>
            <Input
              id="adjust-handed"
              dir="ltr"
              inputMode="decimal"
              className="num"
              value={handed}
              onChange={(e) => setHanded(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="adjust-note">{t('note')}</Label>
            <Textarea
              id="adjust-note"
              rows={2}
              maxLength={255}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <ResponsiveDialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={!valid || adjust.isPending}>
              {adjust.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t('saveAdjust')}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/** After closing: what is left on the truck, and a déchargement to the main dépôt. */
function UnloadDialog({
  leftover,
  onClose,
}: {
  leftover: { vehicleId: string; lines: VehicleStockLineDto[] } | null;
  onClose: () => void;
}) {
  const t = useTranslations('tournees');
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const queryClient = useQueryClient();
  const warehousesOn = useFeature(Feature.WAREHOUSES);
  const warehouses = useWarehouses();
  const open = leftover !== null;
  const key = useIdempotencyKey(open);
  const main = warehouses.data?.find((w) => w.isDefault);
  // Only what is positive can be unloaded.
  const lines = (leftover?.lines ?? []).filter((l) => money(l.qtyBase).gt(0));

  const unload = useMutation({
    mutationFn: () => {
      if (!leftover || !main) throw new Error('no dépôt');
      return api.request<StockTransferDto>('/stock-transfers', {
        method: 'POST',
        body: {
          type: 'UNLOAD',
          fromWarehouseId: leftover.vehicleId,
          toWarehouseId: main.id,
          lines: lines.map((l) => ({ productId: l.productId, unitId: l.unitId, qty: l.qtyBase })),
        },
        idempotencyKey: key,
      });
    },
    onSuccess: (tr) => {
      void queryClient.invalidateQueries({ queryKey: stockKeys.transfers });
      router.push(`/stock/transferts/${tr.id}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent className="md:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('leftoverTitle')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{t('leftoverHelp')}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ul className="max-h-[40vh] divide-y overflow-y-auto rounded-md border">
          {(leftover?.lines ?? []).map((l) => (
            <li
              key={l.productId}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            >
              <span className="min-w-0 truncate">{l.designation}</span>
              <bdi dir="ltr" className="num shrink-0 font-medium">
                {formatQty(l.qtyBase)}
              </bdi>
            </li>
          ))}
        </ul>
        <ResponsiveDialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('later')}
          </Button>
          {warehousesOn ? (
            <Button
              disabled={!main || lines.length === 0 || unload.isPending}
              onClick={() => unload.mutate()}
            >
              {unload.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Truck aria-hidden />
              )}
              {t('unload')}
            </Button>
          ) : null}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
