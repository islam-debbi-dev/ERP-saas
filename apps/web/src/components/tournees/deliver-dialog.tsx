'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  computeTotals,
  type DeliverOrderResultDto,
  money,
  type OrderDto,
  PAYMENT_MODES,
  type PaymentMode,
  parseDA,
  qty,
} from '@erp/shared';
import { GeoPrivacyNotice, isGeoCancelled, useGeoSubmit } from '@/components/geo/use-geo-submit';
import { Amount } from '@/components/shared/amount';
import { usePrint } from '@/components/shared/print-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { api } from '@/lib/api-client';
import { useUnitLabel } from '@/lib/catalog';
import { stockKeys } from '@/lib/stock';
import { tourneeKeys } from '@/lib/tournees';
import { useErrorMessage } from '@/lib/use-error-message';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';

/**
 * Livrer un bon de commande: the quantities actually handed over (less when out of
 * stock) and what the client pays now. The API makes the BL; the rest stays on the order.
 */
export function DeliverDialog({
  order,
  onClose,
  onDelivered,
}: {
  order: OrderDto | null;
  onClose: () => void;
  onDelivered: (order: OrderDto) => void;
}) {
  // Phase 39, A3: a livreur's position goes with the delivery (a note if asked). The
  // note dialog sits outside the form so its submit never reaches the delivery form.
  const geo = useGeoSubmit();
  return (
    <>
      <ResponsiveDialog open={order !== null} onOpenChange={(o) => !o && onClose()}>
        <ResponsiveDialogContent className="md:max-w-lg">
          {/* Remounted per order: the quantities start from what was ordered. */}
          {order ? (
            <Form
              key={order.id}
              order={order}
              geo={geo}
              onClose={onClose}
              onDelivered={onDelivered}
            />
          ) : null}
        </ResponsiveDialogContent>
      </ResponsiveDialog>
      {geo.dialog}
    </>
  );
}

function Form({
  order,
  geo,
  onClose,
  onDelivered,
}: {
  order: OrderDto;
  geo: ReturnType<typeof useGeoSubmit>;
  onClose: () => void;
  onDelivered: (order: OrderDto) => void;
}) {
  const t = useTranslations('orders');
  const tp = useTranslations('sales');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const unitLabel = useUnitLabel();
  const queryClient = useQueryClient();
  const { print } = usePrint();
  const key = useIdempotencyKey(true);
  const [qtys, setQtys] = useState<Record<string, string>>(() =>
    Object.fromEntries(order.lines.map((l) => [l.id, l.qty])),
  );
  const [paid, setPaid] = useState('');
  const [mode, setMode] = useState<PaymentMode>('ESPECES');

  // Free units (UG) go with their paid line, in proportion: the API computes them.
  const parsed = order.lines
    .filter((l) => !l.isFree)
    .map((l) => {
      const v = parseDA(qtys[l.id] ?? '0');
      return { line: l, value: v, ok: v !== null && !v.isNegative() && v.lte(l.qty) };
    });
  const allOk = parsed.every((p) => p.ok);
  const anyDelivered = parsed.some((p) => p.value?.gt(0));
  const paidValue = paid.trim() === '' ? money(0) : parseDA(paid);
  const totals = computeTotals(
    parsed.map((p) => ({
      qty: p.ok && p.value ? p.value.toString() : '0',
      unitPrice: p.line.unitPriceHt,
      tvaRate: p.line.tvaRate,
      discountPct: p.line.discountPct,
    })),
    order.assujettiTva,
  );

  const deliver = useMutation({
    mutationFn: () =>
      geo.run((g) =>
        api.request<DeliverOrderResultDto>(`/orders/${order.id}/deliver`, {
          method: 'POST',
          body: {
            lines: parsed.map((p) => ({
              orderLineId: p.line.id,
              qty: p.value?.toString() ?? '0',
            })),
            paidAmount: (paidValue ?? money(0)).toString(),
            paymentMode: mode,
            ...(g ? { geo: g } : {}),
          },
          idempotencyKey: key,
        }),
      ),
    onSuccess: (res) => {
      geo.after(res.geoCheck, order.client.id);
      onDelivered(res.order);
      void queryClient.invalidateQueries({ queryKey: tourneeKeys.orders });
      void queryClient.invalidateQueries({ queryKey: stockKeys.all });
      toast.success(t('deliveredToast', { number: res.sale.number ?? '' }), {
        action: {
          label: t('printBl'),
          onClick: () =>
            void print(
              `/documents/BL/${res.sale.id}/pdf`,
              undefined,
              `${res.sale.number ?? 'BL'}.pdf`,
            ),
        },
      });
      if (res.warnings.length > 0)
        toast.warning(t('deliveredWarnings', { count: res.warnings.length }));
      onClose();
    },
    onError: (err) => {
      if (!isGeoCancelled(err)) toast.error(errorMessage(err));
    },
  });

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (allOk && anyDelivered && paidValue) deliver.mutate();
      }}
    >
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>
          {t('deliverTitle', { number: order.number ?? '' })}
        </ResponsiveDialogTitle>
        <ResponsiveDialogDescription>{t('deliverHelp')}</ResponsiveDialogDescription>
      </ResponsiveDialogHeader>

      <ul className="grid max-h-[40vh] gap-3 overflow-y-auto">
        {parsed.map(({ line: l, ok }) => {
          const lacking = qty(l.availableBase).lt(l.qtyBase);
          return (
            <li key={l.id} className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-3">
              <div className="min-w-0">
                <Label htmlFor={`deliver-${l.id}`} className="block truncate">
                  {l.designation}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t('ordered', { qty: l.qty, unit: unitLabel({ code: l.unitCode, name: null }) })}
                  {lacking ? (
                    <span className="text-amber-700 dark:text-amber-400"> · {t('notEnough')}</span>
                  ) : null}
                </p>
              </div>
              <Input
                id={`deliver-${l.id}`}
                dir="ltr"
                inputMode="decimal"
                className="num"
                aria-invalid={!ok}
                value={qtys[l.id] ?? ''}
                onChange={(e) => setQtys({ ...qtys, [l.id]: e.target.value })}
              />
            </li>
          );
        })}
      </ul>
      {!allOk ? (
        <p role="alert" className="text-sm text-destructive">
          {t('qtyInvalid')}
        </p>
      ) : null}

      <div className="flex items-baseline justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
        <span>{t('toDeliverTtc')}</span>
        <Amount value={totals.totalTtc} className="font-semibold" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="deliver-paid">{t('paidNow')}</Label>
          <Input
            id="deliver-paid"
            dir="ltr"
            inputMode="decimal"
            className="num"
            placeholder="0"
            aria-invalid={paidValue === null}
            value={paid}
            onChange={(e) => setPaid(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="deliver-mode">{tp('mode')}</Label>
          <NativeSelect
            id="deliver-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as PaymentMode)}
          >
            {PAYMENT_MODES.map((m) => (
              <option key={m} value={m}>
                {tp(`mode${m}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {geo.on ? <GeoPrivacyNotice /> : null}

      <ResponsiveDialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {tc('cancel')}
        </Button>
        <Button type="submit" disabled={!allOk || !anyDelivered || !paidValue || deliver.isPending}>
          {deliver.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {t('deliverSubmit')}
        </Button>
      </ResponsiveDialogFooter>
    </form>
  );
}
