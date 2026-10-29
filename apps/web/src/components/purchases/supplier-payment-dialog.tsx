'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  formatDA,
  money,
  parseDA,
  PAYMENT_MODES,
  type PaymentMode,
  type SupplierDto,
  type SupplierPaymentDto,
} from '@erp/shared';
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
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/use-error-message';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';
import { isolateLtr } from '@/lib/utils';
import { SupplierBalance } from './supplier-balance';

/** Nouveau règlement fournisseur (RGF, phase 21). */
export function SupplierPaymentDialog({
  supplier,
  open,
  onOpenChange,
}: {
  supplier: SupplierDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('supplierAccount');
  const ts = useTranslations('sales');
  const tp = useTranslations('payments');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const key = useIdempotencyKey(open);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<PaymentMode>('ESPECES');
  const [reference, setReference] = useState('');
  const [bank, setBank] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');

  const value = parseDA(amount);
  const validAmount = value !== null && value.gt(0) && value.decimalPlaces() <= 2;
  const after = validAmount ? money(supplier.balance).minus(value) : null;

  const save = useMutation({
    mutationFn: () =>
      api.request<SupplierPaymentDto>('/supplier-payments', {
        method: 'POST',
        idempotencyKey: key,
        body: {
          supplierId: supplier.id,
          amount: value?.toString(),
          mode,
          reference: mode === 'ESPECES' ? '' : reference.trim(),
          bank: mode === 'CHEQUE' ? bank.trim() : '',
          dueDate: mode === 'CHEQUE' && dueDate ? dueDate : null,
          note: note.trim(),
        },
      }),
    onSuccess: (p) => {
      void queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(
        t('paymentCreated', { number: p.number, amount: isolateLtr(formatDA(p.amount)) }),
      );
      onOpenChange(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const canSave = validAmount && !save.isPending;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="md:max-w-xl">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) save.mutate();
          }}
        >
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t('newPayment')}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>{t('newPaymentHelp')}</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          <div className="min-w-0 rounded-md border p-3">
            <p className="truncate font-medium">{supplier.name}</p>
            <p className="flex flex-wrap items-baseline gap-2 text-sm text-muted-foreground">
              {t('balance')} <SupplierBalance value={supplier.balance} />
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rgf-amount">{tp('amount')}</Label>
              <Input
                id="rgf-amount"
                dir="ltr"
                inputMode="decimal"
                className="num"
                autoFocus
                aria-invalid={amount !== '' && !validAmount}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rgf-mode">{tp('mode')}</Label>
              <NativeSelect
                id="rgf-mode"
                value={mode}
                onChange={(e) => setMode(e.target.value as PaymentMode)}
              >
                {PAYMENT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {ts(`mode${m}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {mode !== 'ESPECES' ? (
              <div className="space-y-2">
                <Label htmlFor="rgf-ref">
                  {mode === 'CHEQUE' ? tp('chequeNumber') : tp('transferRef')}
                </Label>
                <Input
                  id="rgf-ref"
                  dir="ltr"
                  maxLength={80}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </div>
            ) : null}
            {mode === 'CHEQUE' ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="rgf-bank">{tp('bank')}</Label>
                  <Input
                    id="rgf-bank"
                    maxLength={80}
                    value={bank}
                    onChange={(e) => setBank(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rgf-due">{tp('dueDate')}</Label>
                  <Input
                    id="rgf-due"
                    type="date"
                    dir="ltr"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </div>
              </>
            ) : null}
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="rgf-note">{tp('note')}</Label>
              <Textarea
                id="rgf-note"
                maxLength={255}
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>

          {after !== null ? (
            <p className="flex flex-wrap items-baseline gap-2 text-sm">
              <span className="text-muted-foreground">{t('balanceAfter')}</span>
              <SupplierBalance value={after.toString()} />
            </p>
          ) : null}

          <ResponsiveDialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tp('cancelButton')}
            </Button>
            <Button type="submit" disabled={!canSave}>
              {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t('savePayment')}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/** Annuler un règlement: the reason is required and kept on the account. */
export function CancelSupplierPaymentDialog({
  payment,
  open,
  onOpenChange,
}: {
  payment: SupplierPaymentDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('supplierAccount');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const key = useIdempotencyKey(open);
  const [reason, setReason] = useState('');
  const cancel = useMutation({
    mutationFn: () =>
      api.request<SupplierPaymentDto>(`/supplier-payments/${payment.id}/cancel`, {
        method: 'POST',
        idempotencyKey: key,
        body: { reason: reason.trim() },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(t('paymentCancelled', { number: payment.number }));
      onOpenChange(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const valid = reason.trim().length >= 3;
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="md:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !cancel.isPending) cancel.mutate();
          }}
        >
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {t('cancelTitle', { number: payment.number })}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>{t('cancelHelp')}</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rgf-reason">{t('cancelReason')}</Label>
            <Textarea
              id="rgf-reason"
              autoFocus
              required
              minLength={3}
              maxLength={255}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <ResponsiveDialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('keep')}
            </Button>
            <Button type="submit" variant="destructive" disabled={!valid || cancel.isPending}>
              {cancel.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t('confirmCancel')}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
