'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  formatDA,
  parseDA,
  qty,
  type ReturnDisposition,
  type SaleDto,
  type SaleResultDto,
} from '@erp/shared';
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
import { useUnitLabel } from '@/lib/catalog';
import { clientKeys } from '@/lib/clients';
import { saleKeys } from '@/lib/sales';
import { formatQty, stockKeys } from '@/lib/stock';
import { useErrorMessage } from '@/lib/use-error-message';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';
import { isolateLtr } from '@/lib/utils';
import { WarehouseSelect } from '@/components/stock/warehouse-select';

interface DialogProps {
  sale: SaleDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function useSaleAction(sale: SaleDto, onDone: (r: SaleResultDto) => void) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({ path, body, key }: { path: string; body: object; key: string }) =>
      api.request<SaleResultDto>(path, { method: 'POST', body, idempotencyKey: key }),
    onSuccess: (r) => {
      queryClient.setQueryData(saleKeys.one(sale.id), r.sale);
      void queryClient.invalidateQueries({ queryKey: saleKeys.all });
      void queryClient.invalidateQueries({ queryKey: stockKeys.all });
      void queryClient.invalidateQueries({ queryKey: clientKeys.all });
      onDone(r);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function CancelSaleDialog({ sale, open, onOpenChange }: DialogProps) {
  const t = useTranslations('sales');
  const key = useIdempotencyKey(open);
  const [reason, setReason] = useState('');
  const action = useSaleAction(sale, () => {
    toast.success(t('cancelled'));
    onOpenChange(false);
  });
  const valid = reason.trim().length >= 3;
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !action.isPending) {
              action.mutate({
                path: `/sales/${sale.id}/cancel`,
                key,
                body: { reason: reason.trim() },
              });
            }
          }}
        >
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {sale.status === 'DRAFT' ? t('cancelDraftTitle') : t('cancelTitle')}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {sale.status === 'DRAFT'
                ? t('cancelDraftBody')
                : sale.sourceBls.length > 0
                  ? t('cancelInvoiceBody')
                  : t('cancelBody')}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cancel-reason">{t('reason')}</Label>
            <Input
              id="cancel-reason"
              autoFocus
              required
              minLength={3}
              maxLength={255}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <ResponsiveDialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('keep')}
            </Button>
            <Button type="submit" variant="destructive" disabled={!valid || action.isPending}>
              {action.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t('confirmCancel')}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

export function ReturnDialog({ sale, open, onOpenChange }: DialogProps) {
  const t = useTranslations('sales');
  const unitLabel = useUnitLabel();
  const key = useIdempotencyKey(open);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [disposition, setDisposition] = useState<ReturnDisposition>('RESTOCK');
  const [reason, setReason] = useState('');
  // Phase 15: '' = back to the dépôt the sale left from.
  const [warehouseId, setWarehouseId] = useState('');
  const action = useSaleAction(sale, (r) => {
    toast.success(t('returned', { number: r.sale.returns.at(-1)?.number ?? '' }));
    onOpenChange(false);
    setQuantities({});
    setReason('');
  });

  /** What is left to return, in the line's unit. */
  const available = (l: SaleDto['lines'][number]) =>
    qty(l.qtyBase).minus(l.returnedQtyBase).div(l.factorToBase);
  const picked = sale.lines.flatMap((l) => {
    const q = parseDA(quantities[l.id] ?? '');
    return q && q.gt(0) ? [{ line: l, qty: q }] : [];
  });
  const tooMuch = picked.some((p) => p.qty.gt(available(p.line)));
  const valid = picked.length > 0 && !tooMuch && reason.trim().length >= 3;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="md:max-w-2xl">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid || action.isPending) return;
            action.mutate({
              path: `/sales/${sale.id}/returns`,
              key,
              body: {
                ...(warehouseId ? { warehouseId } : {}),
                disposition,
                reason: reason.trim(),
                lines: picked.map((p) => ({ saleLineId: p.line.id, qty: p.qty.toString() })),
              },
            });
          }}
        >
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t('returnTitle')}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>{t('returnHelp')}</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          {sale.lines.some((l) => l.isFree) ? (
            <p className="text-sm text-muted-foreground">{t('returnFreeHelp')}</p>
          ) : null}
          <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
            {/* Free units (UG) come back with their paid line, in proportion (API). */}
            {sale.lines
              .filter((l) => !l.isFree)
              .map((l) => {
                const left = available(l);
                const q = parseDA(quantities[l.id] ?? '');
                return (
                  <li
                    key={l.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{l.designation}</p>
                      <p className="text-xs text-muted-foreground">
                        {t('leftToReturn', {
                          qty: isolateLtr(formatQty(left.toString())),
                          unit: unitLabel({ code: l.unitCode, name: l.unitName }),
                          price: isolateLtr(formatDA(l.unitPriceHt)),
                        })}
                      </p>
                    </div>
                    <Input
                      aria-label={t('returnQtyOf', { product: l.designation })}
                      dir="ltr"
                      inputMode="decimal"
                      className="num w-28"
                      disabled={left.lte(0)}
                      aria-invalid={q !== null && q.gt(left)}
                      value={quantities[l.id] ?? ''}
                      onChange={(e) => setQuantities((s) => ({ ...s, [l.id]: e.target.value }))}
                    />
                  </li>
                );
              })}
          </ul>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="return-disposition">{t('disposition')}</Label>
              <NativeSelect
                id="return-disposition"
                value={disposition}
                onChange={(e) => setDisposition(e.target.value as ReturnDisposition)}
              >
                <option value="RESTOCK">{t('dispositionRESTOCK')}</option>
                <option value="DAMAGED">{t('dispositionDAMAGED')}</option>
              </NativeSelect>
            </div>
            <WarehouseSelect
              id="return-warehouse"
              value={warehouseId}
              onChange={setWarehouseId}
              defaultLabel={
                sale.warehouse
                  ? t('returnToSaleWarehouse', { name: sale.warehouse.name })
                  : t('returnToMain')
              }
            />
            <div className="space-y-2">
              <Label htmlFor="return-reason">{t('reason')}</Label>
              <Input
                id="return-reason"
                required
                minLength={3}
                maxLength={255}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </div>
          {tooMuch ? (
            <p role="status" className="text-sm text-destructive">
              {t('returnTooMuch')}
            </p>
          ) : null}
          <ResponsiveDialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('keep')}
            </Button>
            <Button type="submit" disabled={!valid || action.isPending}>
              {action.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t('confirmReturn')}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
