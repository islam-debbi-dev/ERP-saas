'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Minus, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  type ExpenseDto,
  ExpenseCategoryKey,
  Feature,
  formatDA,
  parseDA,
  PAYMENT_MODES,
  type PaymentMode,
  type RentContractDto,
  rentSlotsFrom,
  sum,
  toMoneyString,
} from '@erp/shared';
import { Amount } from '@/components/shared/amount';
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
import { useFeature } from '@/lib/auth';
import { expenseKeys, useExpenseCategories } from '@/lib/expenses';
import { todayInAlgiers } from '@/lib/purchases';
import { useErrorMessage } from '@/lib/use-error-message';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';
import { cn, isolateLtr } from '@/lib/utils';
import { useWarehouseScope } from '@/lib/warehouse-scope';
import { DayText } from './day-text';

/**
 * Nouvelle dépense: the amount first, a category chip, today by default (phase 25). With
 * `rent`, a rent payment of that contract: the next unpaid periods, prefilled.
 */
export function ExpenseDialog({
  open,
  onOpenChange,
  rent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rent?: RentContractDto;
}) {
  const t = useTranslations('expenses');
  const ts = useTranslations('sales');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const key = useIdempotencyKey(open);
  const multiUnit = useFeature(Feature.MULTI_UNIT);
  const scope = useWarehouseScope();
  const categories = useExpenseCategories(open);
  const choices = (categories.data ?? []).filter((c) => c.key !== ExpenseCategoryKey.RENT || !rent);

  // Rent: how many periods from the first one not paid.
  const [periods, setPeriods] = useState(1);
  const slots = rent
    ? rentSlotsFrom(
        {
          amount: rent.amount,
          period: rent.period,
          startDate: rent.startDate,
          endDate: rent.endDate,
        },
        rent.nextDueDate ?? rent.startDate,
        periods,
      )
    : [];
  const rentAmount = slots.length > 0 ? toMoneyString(sum(slots.map((s) => s.amount))) : '';

  const [amount, setAmount] = useState(rent ? rentAmount : '');
  const [amountTouched, setAmountTouched] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [date, setDate] = useState(todayInAlgiers);
  const [mode, setMode] = useState<PaymentMode>('ESPECES');
  const [reference, setReference] = useState('');
  const [payee, setPayee] = useState(rent?.landlordName ?? '');
  const [withPeriod, setWithPeriod] = useState(false);
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [note, setNote] = useState('');
  const [warehouseId, setWarehouseId] = useState(
    scope.warehouseId || (scope.options.length === 1 ? scope.options[0]!.id : ''),
  );

  const shownAmount = rent && !amountTouched ? rentAmount : amount;
  const value = parseDA(shownAmount);
  const validAmount = value !== null && value.gt(0) && value.decimalPlaces() <= 2;
  const validPeriod =
    !withPeriod || (periodStart !== '' && periodEnd !== '' && periodEnd >= periodStart);
  const needsDepot = multiUnit && !rent && scope.options.length > 1;

  const save = useMutation({
    mutationFn: () =>
      api.request<ExpenseDto>('/expenses', {
        method: 'POST',
        idempotencyKey: key,
        body: {
          amount: value?.toString(),
          date,
          mode,
          reference: reference.trim(),
          payee: payee.trim(),
          note: note.trim(),
          ...(rent
            ? {
                rentContractId: rent.id,
                periodStart: slots[0]?.start ?? null,
                periodEnd: slots.at(-1)?.end ?? null,
              }
            : {
                categoryId,
                periodStart: withPeriod ? periodStart : null,
                periodEnd: withPeriod ? periodEnd : null,
                ...(warehouseId ? { warehouseId } : {}),
              }),
        },
      }),
    onSuccess: (e) => {
      void queryClient.invalidateQueries({ queryKey: expenseKeys.all });
      toast.success(t('created', { number: e.number, amount: isolateLtr(formatDA(e.amount)) }));
      onOpenChange(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const canSave =
    validAmount &&
    validPeriod &&
    (rent ? slots.length > 0 : categoryId !== '') &&
    (!needsDepot || warehouseId !== '') &&
    !save.isPending;

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
            <ResponsiveDialogTitle>
              {rent ? t('payRentTitle') : t('newTitle')}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {rent ? t('payRentHelp', { landlord: rent.landlordName }) : t('newHelp')}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          {rent ? (
            <div className="grid gap-2 rounded-md border p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium" id="exp-periods-label">
                  {t('periodsToPay')}
                </span>
                <div
                  className="flex items-center gap-2"
                  role="group"
                  aria-labelledby="exp-periods-label"
                >
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-11"
                    aria-label={t('fewerPeriods')}
                    disabled={periods <= 1}
                    onClick={() => setPeriods((n) => n - 1)}
                  >
                    <Minus aria-hidden />
                  </Button>
                  <span className="num w-8 text-center font-semibold" aria-live="polite">
                    {slots.length}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-11"
                    aria-label={t('morePeriods')}
                    disabled={periods >= 24 || slots.length < periods}
                    onClick={() => setPeriods((n) => n + 1)}
                  >
                    <Plus aria-hidden />
                  </Button>
                </div>
              </div>
              {slots.length > 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('periodCovered')} <DayText day={slots[0]!.start} /> →{' '}
                  <DayText day={slots.at(-1)!.end} />
                </p>
              ) : (
                <p className="text-sm text-destructive">{t('nothingToPay')}</p>
              )}
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="exp-amount">{t('amount')}</Label>
            <Input
              id="exp-amount"
              dir="ltr"
              inputMode="decimal"
              className="num h-12 text-lg font-semibold"
              autoFocus={!rent}
              aria-invalid={shownAmount !== '' && !validAmount}
              value={shownAmount}
              onChange={(e) => {
                setAmountTouched(true);
                setAmount(e.target.value);
              }}
            />
            {rent && amountTouched && rentAmount && shownAmount !== rentAmount ? (
              <p className="text-xs text-muted-foreground">
                {t('contractAmount')} <Amount value={rentAmount} />
              </p>
            ) : null}
          </div>

          {rent ? null : (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t('category')}</legend>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('category')}>
                {choices.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={categoryId === c.id}
                    onClick={() => setCategoryId(c.id)}
                    className={cn(
                      'min-h-11 max-w-full truncate rounded-full border px-4 text-sm transition-colors',
                      categoryId === c.id
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'bg-background hover:bg-muted',
                    )}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="exp-date">{t('date')}</Label>
              <Input
                id="exp-date"
                type="date"
                dir="ltr"
                value={date}
                max={todayInAlgiers()}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="exp-mode">{t('mode')}</Label>
              <NativeSelect
                id="exp-mode"
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
            {needsDepot ? (
              <div className="space-y-2">
                <Label htmlFor="exp-depot">{t('depot')}</Label>
                <NativeSelect
                  id="exp-depot"
                  value={warehouseId}
                  onChange={(e) => setWarehouseId(e.target.value)}
                >
                  <option value="">{t('pickDepot')}</option>
                  {scope.options.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="exp-payee">{t('payee')}</Label>
              <Input
                id="exp-payee"
                maxLength={120}
                value={payee}
                onChange={(e) => setPayee(e.target.value)}
              />
            </div>
            {mode !== 'ESPECES' ? (
              <div className="space-y-2">
                <Label htmlFor="exp-ref">{t('reference')}</Label>
                <Input
                  id="exp-ref"
                  dir="ltr"
                  maxLength={80}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </div>
            ) : null}
          </div>

          {rent ? null : (
            <div className="space-y-3">
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="size-5 accent-primary"
                  checked={withPeriod}
                  onChange={(e) => setWithPeriod(e.target.checked)}
                />
                <span>
                  {t('coversPeriod')}
                  <span className="block text-xs text-muted-foreground">
                    {t('coversPeriodHelp')}
                  </span>
                </span>
              </label>
              {withPeriod ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="exp-from">{t('periodStart')}</Label>
                    <Input
                      id="exp-from"
                      type="date"
                      dir="ltr"
                      value={periodStart}
                      onChange={(e) => setPeriodStart(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="exp-to">{t('periodEnd')}</Label>
                    <Input
                      id="exp-to"
                      type="date"
                      dir="ltr"
                      min={periodStart || undefined}
                      aria-invalid={!validPeriod && periodEnd !== ''}
                      value={periodEnd}
                      onChange={(e) => setPeriodEnd(e.target.value)}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="exp-note">{t('note')}</Label>
            <Input
              id="exp-note"
              maxLength={255}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <ResponsiveDialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('cancelButton')}
            </Button>
            <Button type="submit" disabled={!canSave}>
              {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t('save')}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
