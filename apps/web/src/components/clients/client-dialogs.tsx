'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { type ClientDto, parseDA } from '@erp/shared';
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
import { NativeSelect } from '@/components/ui/native-select';
import { api } from '@/lib/api-client';
import { clientKeys } from '@/lib/clients';
import { useErrorMessage } from '@/lib/use-error-message';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';

interface DialogProps {
  client: ClientDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** "debt" = the client owes more (+), "credit" = the client owes less (-). */
type Direction = 'debt' | 'credit';

function useAccountMutation(client: ClientDto, onDone: () => void) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({ path, body, key }: { path: string; body: object; key: string }) =>
      api.request<ClientDto>(path, { method: 'POST', body, idempotencyKey: key }),
    onSuccess: (saved) => {
      queryClient.setQueryData(clientKeys.one(client.id), saved);
      void queryClient.invalidateQueries({ queryKey: clientKeys.all });
      onDone();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

function AmountFields({
  prefix,
  direction,
  onDirection,
  amount,
  onAmount,
  debtLabel,
  creditLabel,
}: {
  prefix: string;
  direction: Direction;
  onDirection: (d: Direction) => void;
  amount: string;
  onAmount: (v: string) => void;
  debtLabel: string;
  creditLabel: string;
}) {
  const t = useTranslations('clients');
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`${prefix}-direction`}>{t('direction')}</Label>
        <NativeSelect
          id={`${prefix}-direction`}
          value={direction}
          onChange={(e) => onDirection(e.target.value as Direction)}
        >
          <option value="debt">{debtLabel}</option>
          <option value="credit">{creditLabel}</option>
        </NativeSelect>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${prefix}-amount`}>{t('amount')}</Label>
        <Input
          id={`${prefix}-amount`}
          dir="ltr"
          inputMode="decimal"
          autoFocus
          className="num"
          value={amount}
          onChange={(e) => onAmount(e.target.value)}
        />
      </div>
    </>
  );
}

/** A positive amount with at most 2 decimals, signed by the direction. */
function signed(amount: string, direction: Direction): string | null {
  const parsed = parseDA(amount);
  if (!parsed || !parsed.gt(0) || parsed.decimalPlaces() > 2) return null;
  return direction === 'credit' ? parsed.negated().toString() : parsed.toString();
}

export function OpeningBalanceDialog({ client, open, onOpenChange }: DialogProps) {
  const t = useTranslations('clients');
  const key = useIdempotencyKey(open);
  const [direction, setDirection] = useState<Direction>('debt');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const mutation = useAccountMutation(client, () => {
    toast.success(t('openingDone'));
    onOpenChange(false);
  });
  const value = signed(amount, direction);

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!value || mutation.isPending) return;
            mutation.mutate({
              path: `/clients/${client.id}/opening-balance`,
              key,
              body: { amount: value, note: note.trim() },
            });
          }}
        >
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t('openingTitle')}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {client.name}. {t('openingHelp')}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <AmountFields
              prefix="opening"
              direction={direction}
              onDirection={setDirection}
              amount={amount}
              onAmount={setAmount}
              debtLabel={t('openingDebt')}
              creditLabel={t('openingCredit')}
            />
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="opening-note">{t('note')}</Label>
              <Input
                id="opening-note"
                maxLength={255}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={!value || mutation.isPending}>
              {mutation.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t('openingSubmit')}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

export function AdjustmentDialog({ client, open, onOpenChange }: DialogProps) {
  const t = useTranslations('clients');
  const key = useIdempotencyKey(open);
  const [direction, setDirection] = useState<Direction>('credit');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const mutation = useAccountMutation(client, () => {
    toast.success(t('adjustDone'));
    onOpenChange(false);
    setAmount('');
    setReason('');
  });
  const value = signed(amount, direction);
  const valid = value !== null && reason.trim().length >= 3;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid || mutation.isPending) return;
            mutation.mutate({
              path: `/clients/${client.id}/adjustments`,
              key,
              body: { amount: value, reason: reason.trim() },
            });
          }}
        >
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t('adjustTitle')}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {client.name}. {t('adjustHelp')}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <AmountFields
              prefix="adjust"
              direction={direction}
              onDirection={setDirection}
              amount={amount}
              onAmount={setAmount}
              debtLabel={t('adjustDebt')}
              creditLabel={t('adjustCredit')}
            />
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="adjust-reason">{t('reason')}</Label>
              <Input
                id="adjust-reason"
                required
                minLength={3}
                maxLength={255}
                aria-describedby="adjust-reason-hint"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <p id="adjust-reason-hint" className="text-xs text-muted-foreground">
                {t('reasonHint')}
              </p>
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={!valid || mutation.isPending}>
              {mutation.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t('adjustSubmit')}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
