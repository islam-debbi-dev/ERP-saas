'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  ALLOCATION_METHODS,
  type AllocationMethod,
  CURRENCIES,
  IMPORT_COST_TYPES,
  type ImportCostType,
  type ImportFileDto,
  type LandedCostPreviewLineDto,
  money,
  parseDA,
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
import { importFileKeys } from '@/lib/import-files';
import { useSuppliers } from '@/lib/purchases';
import { stockKeys } from '@/lib/stock';
import { useErrorMessage } from '@/lib/use-error-message';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';

const validAmount = (v: string, allowZero = false) => {
  const p = parseDA(v);
  return p !== null && (allowZero ? !p.isNegative() : p.gt(0)) && p.decimalPlaces() <= 2;
};

/**
 * Adds a cost line to an open dossier, or (`late`) a late cost to a closed one, which
 * goes to the CUMP of the units still on hand (COST_ADJUST) and the rest to the écart.
 */
export function ImportCostDialog({
  file,
  lines,
  late,
  open,
  onOpenChange,
}: {
  file: ImportFileDto;
  /** The allocation lines, for a manual split. */
  lines: LandedCostPreviewLineDto[];
  late: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('importFiles');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const key = useIdempotencyKey(open);
  const suppliers = useSuppliers('', open);
  const [type, setType] = useState<ImportCostType>('FRET');
  const [label, setLabel] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [freeCurrency, setFreeCurrency] = useState('DZD');
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('');
  const [tva, setTva] = useState('');
  const [method, setMethod] = useState<AllocationMethod>('VALUE');
  const [split, setSplit] = useState<Record<string, string>>({});

  // A cost owed to a supplier is in that supplier's currency.
  const supplier = suppliers.data?.items.find((s) => s.id === supplierId);
  const currency = supplier?.currency ?? freeCurrency;
  const foreign = currency !== 'DZD';
  const rateValue = parseDA(rate);
  const rateOk =
    !foreign || (rateValue !== null && rateValue.gt(0) && rateValue.decimalPlaces() <= 6);
  const amountValue = parseDA(amount);
  const amountDzd = amountValue && rateOk ? amountValue.times(foreign ? rateValue! : 1) : null;
  const splitTotal = Object.values(split).reduce((sum, v) => sum.plus(parseDA(v) ?? 0), money(0));
  const splitOk =
    method !== 'MANUAL' ||
    (Object.values(split).every((v) => v === '' || validAmount(v, true)) && splitTotal.gt(0));
  const canSave =
    validAmount(amount) &&
    rateOk &&
    (type === 'TVA_IMPORT' || tva === '' || validAmount(tva, true)) &&
    splitOk;

  const save = useMutation({
    mutationFn: () =>
      api.request<ImportFileDto>(`/import-files/${file.id}/${late ? 'late-cost' : 'costs'}`, {
        method: 'POST',
        idempotencyKey: key,
        body: {
          type,
          label: label.trim(),
          supplierId: supplierId || null,
          currency,
          amount: amountValue?.toString(),
          ...(foreign && rateValue ? { exchangeRate: rateValue.toString() } : {}),
          tvaAmount: type === 'TVA_IMPORT' ? '0' : (parseDA(tva) ?? money(0)).toString(),
          method,
          manualSplit:
            method === 'MANUAL'
              ? Object.fromEntries(
                  Object.entries(split)
                    .filter(([, v]) => v !== '')
                    .map(([k, v]) => [k, (parseDA(v) ?? money(0)).toString()]),
                )
              : null,
        },
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(importFileKeys.one(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: importFileKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      if (late) void queryClient.invalidateQueries({ queryKey: stockKeys.all });
      toast.success(late ? t('lateCostAdded') : t('costAdded'));
      onOpenChange(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="md:max-w-xl">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave && !save.isPending) save.mutate();
          }}
        >
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {late ? t('lateCostTitle') : t('addCost')}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {late ? t('lateCostBody') : t('costBody')}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cost-type">{t('costType')}</Label>
              <NativeSelect
                id="cost-type"
                value={type}
                onChange={(e) => setType(e.target.value as ImportCostType)}
              >
                {IMPORT_COST_TYPES.map((c) => (
                  <option key={c} value={c}>
                    {t(`costType${c}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cost-label">{t('costLabel')}</Label>
              <Input id="cost-label" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="cost-supplier">{t('costSupplier')}</Label>
              <NativeSelect
                id="cost-supplier"
                aria-describedby="cost-supplier-hint"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                <option value="">{t('noCostSupplier')}</option>
                {(suppliers.data?.items ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.currency !== 'DZD' ? ` (${s.currency})` : ''}
                  </option>
                ))}
              </NativeSelect>
              <p id="cost-supplier-hint" className="text-xs text-muted-foreground">
                {t('costSupplierHint')}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cost-currency">{t('currency')}</Label>
              <NativeSelect
                id="cost-currency"
                value={currency}
                disabled={Boolean(supplier)}
                onChange={(e) => setFreeCurrency(e.target.value)}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cost-amount">{t('costAmount', { currency })}</Label>
              <Input
                id="cost-amount"
                dir="ltr"
                inputMode="decimal"
                className="num"
                aria-invalid={amount !== '' && !validAmount(amount) ? true : undefined}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            {foreign ? (
              <div className="space-y-2">
                <Label htmlFor="cost-rate">{t('exchangeRate', { currency })}</Label>
                <Input
                  id="cost-rate"
                  dir="ltr"
                  inputMode="decimal"
                  className="num"
                  aria-invalid={rate !== '' && !rateOk ? true : undefined}
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                />
              </div>
            ) : null}
            {/* The import VAT line is all TVA: the API takes its whole amount as such. */}
            {type !== 'TVA_IMPORT' ? (
              <div className="space-y-2">
                <Label htmlFor="cost-tva">{t('costTva')}</Label>
                <Input
                  id="cost-tva"
                  dir="ltr"
                  inputMode="decimal"
                  className="num"
                  aria-describedby="cost-tva-hint"
                  aria-invalid={tva !== '' && !validAmount(tva, true) ? true : undefined}
                  value={tva}
                  onChange={(e) => setTva(e.target.value)}
                />
                <p id="cost-tva-hint" className="text-xs text-muted-foreground">
                  {t('costTvaHint')}
                </p>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="cost-method">{t('method')}</Label>
              <NativeSelect
                id="cost-method"
                value={method}
                onChange={(e) => setMethod(e.target.value as AllocationMethod)}
              >
                {ALLOCATION_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {t(`method${m}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          {foreign && amountDzd ? (
            <p className="text-sm text-muted-foreground">
              {t('amountDzd')} <Amount value={amountDzd} />
            </p>
          ) : null}
          {method === 'MANUAL' ? (
            <fieldset className="grid gap-2 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">{t('manualSplit')}</legend>
              {lines.map((l) => (
                <div key={l.purchaseLineId} className="flex items-center gap-2">
                  <Label htmlFor={`split-${l.purchaseLineId}`} className="min-w-0 flex-1 truncate">
                    {l.designation}
                  </Label>
                  <Input
                    id={`split-${l.purchaseLineId}`}
                    dir="ltr"
                    inputMode="decimal"
                    className="num w-32"
                    value={split[l.purchaseLineId] ?? ''}
                    onChange={(e) =>
                      setSplit((s) => ({ ...s, [l.purchaseLineId]: e.target.value }))
                    }
                  />
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                {t('manualSplitHint')} <Amount value={splitTotal} />
              </p>
            </fieldset>
          ) : null}
          <ResponsiveDialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={!canSave || save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {late ? t('lateCostSubmit') : t('addCost')}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
