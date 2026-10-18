'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Undo2, XCircle } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { formatDA, parseDA, type PurchaseDto, qty } from '@erp/shared';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api-client';
import { useUnitLabel } from '@/lib/catalog';
import { purchaseKeys } from '@/lib/purchases';
import { formatQty, stockKeys } from '@/lib/stock';
import { useErrorMessage } from '@/lib/use-error-message';

/** Quantity still returnable, in the line's own unit. */
function remainingInUnit(line: PurchaseDto['lines'][number]) {
  return qty(line.qtyBase).minus(line.returnedQtyBase).div(line.factorToBase).toDecimalPlaces(3);
}

export function PurchaseView({ purchase }: { purchase: PurchaseDto }) {
  const t = useTranslations('purchases');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const unitLabel = useUnitLabel();
  const queryClient = useQueryClient();
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnQty, setReturnQty] = useState<Record<string, string>>({});
  const [keys, setKeys] = useState(() => ({
    cancel: crypto.randomUUID(),
    ret: crypto.randomUUID(),
  }));
  const validated = purchase.status === 'VALIDATED';

  const onDone = (next: PurchaseDto) => {
    queryClient.setQueryData(purchaseKeys.one(next.id), next);
    void queryClient.invalidateQueries({ queryKey: purchaseKeys.all });
    void queryClient.invalidateQueries({ queryKey: stockKeys.all });
  };

  const cancel = useMutation({
    mutationFn: () =>
      api.request<PurchaseDto>(`/purchases/${purchase.id}/cancel`, {
        method: 'POST',
        idempotencyKey: keys.cancel,
      }),
    onSuccess: (next) => {
      onDone(next);
      toast.success(t('cancelled'));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const createReturn = useMutation({
    mutationFn: (lines: { purchaseLineId: string; qty: string }[]) =>
      api.request<PurchaseDto>(`/purchases/${purchase.id}/returns`, {
        method: 'POST',
        body: { lines },
        idempotencyKey: keys.ret,
      }),
    onSuccess: (next) => {
      onDone(next);
      toast.success(t('returnDone'));
      setReturnOpen(false);
      setReturnQty({});
      setKeys((k) => ({ ...k, ret: crypto.randomUUID() }));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const returnLines = purchase.lines.flatMap((l) => {
    const v = parseDA(returnQty[l.id] ?? '');
    return v !== null && v.gt(0) ? [{ purchaseLineId: l.id, qty: v.toString() }] : [];
  });
  const returnInvalid = purchase.lines.some((l) => {
    const v = parseDA(returnQty[l.id] ?? '');
    return v !== null && v.gt(remainingInUnit(l));
  });
  const anyReturnable = purchase.lines.some((l) => remainingInUnit(l).gt(0));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      {/* Information, not an error: announced politely. */}
      <Alert role="status">
        <AlertDescription>
          {validated
            ? t('readOnlyValidated', {
                date: format.dateTime(new Date(purchase.validatedAt ?? purchase.createdAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }),
              })
            : t('readOnlyCancelled')}
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            {purchase.supplier.name}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-3">
          <p>
            <span className="text-muted-foreground">{t('date')}: </span>
            {format.dateTime(new Date(`${purchase.documentDate}T12:00:00Z`), {
              dateStyle: 'medium',
            })}
          </p>
          {purchase.supplierRef ? (
            <p>
              <span className="text-muted-foreground">{t('supplierRef')}: </span>
              <span dir="ltr">{purchase.supplierRef}</span>
            </p>
          ) : null}
          {purchase.note ? (
            <p>
              <span className="text-muted-foreground">{t('note')}: </span>
              {purchase.note}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[40rem] text-sm">
          <caption className="sr-only">{t('linesSection')}</caption>
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="p-3 text-start font-medium">{t('colProduct')}</th>
              <th className="p-3 text-end font-medium">{t('colQty')}</th>
              <th className="p-3 text-end font-medium">{t('colCost')}</th>
              <th className="p-3 text-end font-medium">{t('colLineHt')}</th>
              <th className="p-3 text-end font-medium">{t('colReturned')}</th>
            </tr>
          </thead>
          <tbody>
            {purchase.lines.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="p-3 font-medium">{l.designation}</td>
                <td className="num p-3 text-end whitespace-nowrap">
                  {formatQty(l.qty)} {unitLabel({ code: l.unitCode, name: l.unitName })}
                </td>
                <td className="num p-3 text-end whitespace-nowrap" dir="ltr">
                  {formatDA(l.unitCost)}
                </td>
                <td className="num p-3 text-end whitespace-nowrap font-medium" dir="ltr">
                  {formatDA(l.lineHt)}
                </td>
                <td className="num p-3 text-end text-muted-foreground" dir="ltr">
                  {qty(l.returnedQtyBase).isZero()
                    ? '—'
                    : formatQty(qty(l.returnedQtyBase).div(l.factorToBase).toString())}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Card>
        <CardContent className="num grid gap-1 text-sm sm:ms-auto sm:w-80">
          <div className="flex justify-between">
            <span>{t('totalHt')}</span>
            <span dir="ltr">{formatDA(purchase.totalHt)}</span>
          </div>
          {purchase.tvaByRate.map((r) => (
            <div key={r.rate} className="flex justify-between text-muted-foreground">
              <span>{t('tvaAt', { rate: qty(r.rate).toString() })}</span>
              <span dir="ltr">{formatDA(r.tva)}</span>
            </div>
          ))}
          <div className="flex justify-between border-t pt-1 text-base font-semibold">
            <span>{t('totalTtc')}</span>
            <span dir="ltr">{formatDA(purchase.totalTtc)}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>{t('paid')}</span>
            <span dir="ltr">{formatDA(purchase.paidAmount)}</span>
          </div>
        </CardContent>
      </Card>

      {purchase.returns.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              {t('returns')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {purchase.returns.map((r) => (
                <li key={r.id} className="flex justify-between gap-3 py-2">
                  <span className="font-medium tabular-nums" dir="ltr">
                    {r.number}
                  </span>
                  <span className="text-muted-foreground">
                    {format.dateTime(new Date(r.createdAt), { dateStyle: 'medium' })}
                  </span>
                  <span className="num font-medium" dir="ltr">
                    {formatDA(r.totalTtc)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {validated ? (
        <div className="sticky bottom-0 -mx-4 flex flex-wrap justify-between gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur lg:-mx-6 lg:px-6">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" disabled={cancel.isPending}>
                <XCircle aria-hidden />
                {t('cancelBr')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('cancelTitle')}</AlertDialogTitle>
                <AlertDialogDescription>{t('cancelBodyValidated')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('keep')}</AlertDialogCancel>
                <AlertDialogAction onClick={() => cancel.mutate()}>
                  {t('cancelBr')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button variant="outline" disabled={!anyReturnable} onClick={() => setReturnOpen(true)}>
            <Undo2 aria-hidden />
            {t('returnBtn')}
          </Button>
        </div>
      ) : null}

      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent className="sm:max-w-lg">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (returnLines.length > 0 && !returnInvalid) createReturn.mutate(returnLines);
            }}
          >
            <DialogHeader>
              <DialogTitle>{t('returnTitle')}</DialogTitle>
              <DialogDescription>{t('returnHelp')}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              {purchase.lines.map((l, i) => {
                const max = remainingInUnit(l);
                const v = parseDA(returnQty[l.id] ?? '');
                const tooMuch = v !== null && v.gt(max);
                return (
                  <div
                    key={l.id}
                    className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-3"
                  >
                    <label htmlFor={`ret-${l.id}`} className="text-sm">
                      <span className="font-medium">{l.designation}</span>
                      <span className="block text-xs text-muted-foreground">
                        {unitLabel({ code: l.unitCode, name: l.unitName })} ·{' '}
                        {t('returnMax', { max: formatQty(max.toString()) })}
                      </span>
                    </label>
                    <Input
                      id={`ret-${l.id}`}
                      dir="ltr"
                      inputMode="decimal"
                      className="num"
                      autoFocus={i === 0}
                      disabled={max.lte(0)}
                      aria-invalid={tooMuch ? true : undefined}
                      value={returnQty[l.id] ?? ''}
                      onChange={(e) => setReturnQty((r) => ({ ...r, [l.id]: e.target.value }))}
                    />
                  </div>
                );
              })}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setReturnOpen(false)}>
                {t('cancel')}
              </Button>
              <Button
                type="submit"
                disabled={createReturn.isPending || returnLines.length === 0 || returnInvalid}
              >
                {createReturn.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {t('returnSubmit')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
