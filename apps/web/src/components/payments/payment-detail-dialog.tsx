'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, Loader2, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { parseDA, type PaymentDto, Permission } from '@erp/shared';
import { Button } from '@/components/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { useAuth, usePermission } from '@/lib/auth';
import { clientKeys, useCanManageCredit } from '@/lib/clients';
import { paymentKeys, usePayment } from '@/lib/payments';
import { saleKeys } from '@/lib/sales';
import { useErrorMessage } from '@/lib/use-error-message';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';
import { PrintButton } from '@/components/shared/print-button';
import { PaymentStatusBadge } from './payment-status-badge';
import { Amount } from '@/components/shared/amount';

/** Mirrors the API: with PAYMENT_CANCEL any versement; without it, your own of the day. */
function useCanCancel(p: PaymentDto | undefined): boolean {
  const { state } = useAuth();
  const any = usePermission(Permission.PAYMENT_CANCEL);
  if (!p || p.status !== 'VALID' || p.sale) return false;
  if (any) return true;
  const day = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Algiers' }).format(d);
  return p.receivedBy?.id === state.user?.id && day(new Date(p.receivedAt)) === day(new Date());
}

export function PaymentDetailDialog({
  id,
  open,
  onOpenChange,
}: {
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('payments');
  const ts = useTranslations('sales');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const payment = usePayment(open ? id : '');
  const p = payment.data;
  const canCancel = useCanCancel(p);
  const canBounce =
    useCanManageCredit() && p?.status === 'VALID' && p.mode === 'CHEQUE' && p.client !== null;
  const [action, setAction] = useState<'cancel' | 'bounce' | null>(null);
  const [reason, setReason] = useState('');
  const [fees, setFees] = useState('');
  const key = useIdempotencyKey(action !== null);
  const feesValue = fees.trim() === '' ? null : parseDA(fees);

  const run = useMutation({
    mutationFn: () =>
      api.request<PaymentDto>(`/payments/${id}/${action}`, {
        method: 'POST',
        idempotencyKey: key,
        body:
          action === 'bounce'
            ? { reason: reason.trim(), bankFees: feesValue?.toString() ?? '0' }
            : { reason: reason.trim() },
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(paymentKeys.one(id), updated);
      void queryClient.invalidateQueries({ queryKey: paymentKeys.all });
      void queryClient.invalidateQueries({ queryKey: clientKeys.all });
      void queryClient.invalidateQueries({ queryKey: saleKeys.all });
      toast.success(action === 'bounce' ? t('bounced') : t('cancelled'));
      setAction(null);
      setReason('');
      setFees('');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const valid =
    reason.trim().length >= 3 &&
    (action !== 'bounce' || feesValue === null || !feesValue.isNegative());

  const rows: { label: string; value: React.ReactNode }[] = p
    ? [
        {
          label: t('client'),
          value: p.client ? (
            <Link className="underline-offset-4 hover:underline" href={`/clients/${p.client.id}`}>
              {p.client.name}
            </Link>
          ) : (
            ts('counterClient')
          ),
        },
        { label: t('mode'), value: ts(`mode${p.mode}`) },
        {
          label: t('receivedAt'),
          value: format.dateTime(new Date(p.receivedAt), {
            dateStyle: 'medium',
            timeStyle: 'short',
          }),
        },
        { label: t('receivedBy'), value: p.receivedBy?.fullName ?? '—' },
        ...(p.reference
          ? [
              {
                label: p.mode === 'CHEQUE' ? t('chequeNumber') : t('transferRef'),
                value: <span dir="ltr">{p.reference}</span>,
              },
            ]
          : []),
        ...(p.bank ? [{ label: t('bank'), value: p.bank }] : []),
        ...(p.dueDate
          ? [
              {
                label: t('dueDate'),
                value: format.dateTime(new Date(`${p.dueDate}T12:00:00Z`), { dateStyle: 'medium' }),
              },
            ]
          : []),
        ...(p.sale
          ? [
              {
                label: t('sale'),
                value: (
                  <Link
                    dir="ltr"
                    className="underline underline-offset-4"
                    href={`/ventes/${p.sale.id}`}
                  >
                    {p.sale.number}
                  </Link>
                ),
              },
            ]
          : []),
        ...(p.note ? [{ label: t('note'), value: p.note }] : []),
        ...(p.cancelReason ? [{ label: t('cancelReason'), value: p.cancelReason }] : []),
        ...(p.bounceReason ? [{ label: t('bounceReason'), value: p.bounceReason }] : []),
      ]
    : [];

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="md:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex flex-wrap items-center gap-2">
            <span dir="ltr">{p?.number ?? t('title')}</span>
            {p ? <PaymentStatusBadge status={p.status} /> : null}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {p ? (
              <span dir="ltr" className="num text-lg font-semibold text-foreground">
                <Amount value={p.amount} />
              </span>
            ) : null}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {!p ? (
          <Skeleton className="h-48 w-full" aria-busy />
        ) : (
          <>
            <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
              {rows.map((r) => (
                <div key={r.label} className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{r.label}</dt>
                  <dd className="break-words">{r.value}</dd>
                </div>
              ))}
            </dl>
            {p.allocations.length > 0 ? (
              <div className="space-y-1">
                <p className="text-sm font-medium">{t('allocations')}</p>
                <ul className="divide-y rounded-md border text-sm">
                  {p.allocations.map((a) => (
                    <li
                      key={a.saleId}
                      className="flex items-center justify-between gap-2 px-3 py-1.5"
                    >
                      <Link
                        dir="ltr"
                        href={`/ventes/${a.saleId}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {a.saleNumber}
                      </Link>
                      <span dir="ltr" className="num">
                        <Amount value={a.amount} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {action ? (
              <form
                className="grid gap-3 rounded-md border p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (valid && !run.isPending) run.mutate();
                }}
              >
                <p className="text-sm">{action === 'bounce' ? t('bounceHelp') : t('cancelHelp')}</p>
                <div className="space-y-2">
                  <Label htmlFor="pay-reason">{t('reason')}</Label>
                  <Input
                    id="pay-reason"
                    autoFocus
                    required
                    minLength={3}
                    maxLength={255}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </div>
                {action === 'bounce' ? (
                  <div className="space-y-2">
                    <Label htmlFor="pay-fees">{t('bankFees')}</Label>
                    <Input
                      id="pay-fees"
                      dir="ltr"
                      inputMode="decimal"
                      className="num"
                      placeholder="0"
                      value={fees}
                      onChange={(e) => setFees(e.target.value)}
                    />
                  </div>
                ) : null}
                <div className="flex flex-wrap justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setAction(null)}>
                    {t('keep')}
                  </Button>
                  <Button type="submit" variant="destructive" disabled={!valid || run.isPending}>
                    {run.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                    {action === 'bounce' ? t('confirmBounce') : t('confirmCancel')}
                  </Button>
                </div>
              </form>
            ) : (
              <ResponsiveDialogFooter>
                {p.sale && p.status === 'VALID' ? (
                  <p className="me-auto text-xs text-muted-foreground">{t('linkedToSale')}</p>
                ) : null}
                <PrintButton path={`/payments/${p.id}/receipt.pdf`} />
                {canBounce ? (
                  <Button variant="outline" onClick={() => setAction('bounce')}>
                    <TriangleAlert aria-hidden />
                    {t('bounce')}
                  </Button>
                ) : null}
                {canCancel ? (
                  <Button
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => setAction('cancel')}
                  >
                    <Ban aria-hidden />
                    {t('cancel')}
                  </Button>
                ) : null}
              </ResponsiveDialogFooter>
            )}
          </>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
