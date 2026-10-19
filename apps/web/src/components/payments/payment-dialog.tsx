'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  type ClientDto,
  formatDA,
  money,
  parseDA,
  type PaymentDto,
  type PaymentMode,
  PAYMENT_MODES,
} from '@erp/shared';
import { BalanceAmount } from '@/components/clients/balance-amount';
import { ClientPicker } from '@/components/sales/client-picker';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { api } from '@/lib/api-client';
import { clientKeys, useClient } from '@/lib/clients';
import { paymentKeys, useUnpaidDocuments } from '@/lib/payments';
import { saleKeys } from '@/lib/sales';
import { useErrorMessage } from '@/lib/use-error-message';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';
import { isolateLtr } from '@/lib/utils';

/** Nouveau versement. `client` pre-selects the client (from the client page). */
export function PaymentDialog({
  open,
  onOpenChange,
  client: fixedClient,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client?: ClientDto;
}) {
  const t = useTranslations('payments');
  const ts = useTranslations('sales');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const key = useIdempotencyKey(open);
  const [picked, setPicked] = useState<ClientDto | null>(fixedClient ?? null);
  const [pickerOpen, setPickerOpen] = useState(!fixedClient);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<PaymentMode>('ESPECES');
  const [reference, setReference] = useState('');
  const [bank, setBank] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const [confirmOver, setConfirmOver] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);

  const live = useClient(picked?.id ?? '');
  const client = picked ? (live.data ?? picked) : null;
  const unpaid = useUnpaidDocuments(client?.id ?? '');
  const value = parseDA(amount);
  const validAmount = value !== null && value.gt(0) && value.decimalPlaces() <= 2;
  const after = client && validAmount ? money(client.balance).minus(value) : null;
  const overpay = after !== null && after.lt(0);

  // What the API will do without manual allocation: oldest documents first.
  const preview: { id: string; number: string | null; amount: string; settled: boolean }[] = [];
  if (validAmount) {
    let left = value;
    for (const d of unpaid.data ?? []) {
      if (left.lte(0)) break;
      const part = left.lt(d.remaining) ? left : money(d.remaining);
      preview.push({
        id: d.saleId,
        number: d.number,
        amount: part.toString(),
        settled: part.eq(d.remaining),
      });
      left = left.minus(part);
    }
  }

  const save = useMutation({
    mutationFn: () =>
      api.request<PaymentDto>('/payments', {
        method: 'POST',
        idempotencyKey: key,
        body: {
          clientId: client?.id,
          amount: value?.toString(),
          mode,
          reference: reference.trim(),
          bank: mode === 'CHEQUE' ? bank.trim() : '',
          dueDate: mode === 'CHEQUE' && dueDate ? dueDate : null,
          note: note.trim(),
        },
      }),
    onSuccess: (p) => {
      void queryClient.invalidateQueries({ queryKey: paymentKeys.all });
      void queryClient.invalidateQueries({ queryKey: clientKeys.all });
      void queryClient.invalidateQueries({ queryKey: saleKeys.all });
      toast.success(t('created', { number: p.number, amount: isolateLtr(formatDA(p.amount)) }));
      onOpenChange(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const canSave = client !== null && validAmount && (!overpay || confirmOver) && !save.isPending;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-xl">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSave) save.mutate();
            }}
          >
            <DialogHeader>
              <DialogTitle>{t('newTitle')}</DialogTitle>
              <DialogDescription>{t('newHelp')}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
              {client ? (
                <div className="min-w-0">
                  <p className="font-medium">{client.name}</p>
                  <p className="flex flex-wrap items-baseline gap-2 text-sm text-muted-foreground">
                    {t('balance')} <BalanceAmount value={client.balance} />
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t('noClient')}</p>
              )}
              {fixedClient ? null : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPickerOpen(true)}
                >
                  <UserRound aria-hidden />
                  {client ? ts('changeClient') : t('pickClient')}
                </Button>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="pay-amount">{t('amount')}</Label>
                <Input
                  id="pay-amount"
                  ref={amountRef}
                  dir="ltr"
                  inputMode="decimal"
                  className="num"
                  autoFocus={Boolean(fixedClient)}
                  aria-invalid={amount !== '' && !validAmount}
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setConfirmOver(false);
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pay-mode">{t('mode')}</Label>
                <NativeSelect
                  id="pay-mode"
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
                  <Label htmlFor="pay-ref">
                    {mode === 'CHEQUE' ? t('chequeNumber') : t('transferRef')}
                  </Label>
                  <Input
                    id="pay-ref"
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
                    <Label htmlFor="pay-bank">{t('bank')}</Label>
                    <Input
                      id="pay-bank"
                      maxLength={80}
                      value={bank}
                      onChange={(e) => setBank(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pay-due">{t('dueDate')}</Label>
                    <Input
                      id="pay-due"
                      type="date"
                      dir="ltr"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                    />
                  </div>
                </>
              ) : null}
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="pay-note">{t('note')}</Label>
                <Input
                  id="pay-note"
                  maxLength={255}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </div>

            {after !== null ? (
              <p className="flex flex-wrap items-baseline gap-2 text-sm">
                <span className="text-muted-foreground">{t('balanceAfter')}</span>
                <BalanceAmount value={after.toString()} />
              </p>
            ) : null}

            {preview.length > 0 ? (
              <div className="space-y-1">
                <p className="text-sm font-medium">{t('allocationPreview')}</p>
                <ul className="divide-y rounded-md border text-sm">
                  {preview.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                      <span dir="ltr">{p.number}</span>
                      <span className="flex items-center gap-2">
                        {p.settled ? (
                          <span className="text-xs text-primary">{t('settled')}</span>
                        ) : null}
                        <span dir="ltr" className="num">
                          {formatDA(p.amount)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {overpay && after ? (
              <Alert role="alert">
                <AlertDescription className="space-y-2">
                  <p>{t('overpayWarning', { amount: isolateLtr(formatDA(after.abs())) })}</p>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={confirmOver}
                      onChange={(e) => setConfirmOver(e.target.checked)}
                    />
                    {t('overpayConfirm')}
                  </label>
                </AlertDescription>
              </Alert>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {t('cancelButton')}
              </Button>
              <Button type="submit" disabled={!canSave}>
                {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {t('save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {fixedClient ? null : (
        <ClientPicker
          open={open && pickerOpen}
          onOpenChange={setPickerOpen}
          withCounter={false}
          onPick={(c) => {
            setPicked(c);
            setConfirmOver(false);
            setTimeout(() => amountRef.current?.focus(), 0);
          }}
        />
      )}
    </>
  );
}
