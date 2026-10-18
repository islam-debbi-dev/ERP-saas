'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  ADJUSTMENT_REASONS,
  type AdjustmentReason,
  parseDA,
  type StockOperationResult,
} from '@erp/shared';
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
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { catalogKeys, useProduct, useUnitLabel } from '@/lib/catalog';
import { formatQty, stockKeys } from '@/lib/stock';
import { useErrorMessage } from '@/lib/use-error-message';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';

interface DialogProps {
  productId: string;
  productName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function useStockMutation(productId: string, onDone: (result: StockOperationResult) => void) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({ path, body, key }: { path: string; body: object; key: string }) =>
      api.request<StockOperationResult>(path, { method: 'POST', body, idempotencyKey: key }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: stockKeys.all });
      void queryClient.invalidateQueries({ queryKey: catalogKeys.product(productId) });
      onDone(result);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

function UnitSelect({
  id,
  productId,
  value,
  onChange,
}: {
  id: string;
  productId: string;
  value: string;
  onChange: (unitId: string) => void;
}) {
  const product = useProduct(productId);
  const unitLabel = useUnitLabel();
  if (!product.data) return <Skeleton className="h-9 w-full" />;
  return (
    <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {product.data.units.map((u) => (
        <option key={u.unitId} value={u.unitId}>
          {unitLabel({ code: u.unitCode, name: u.unitName })}
          {u.unitId !== product.data.baseUnitId ? ` (×${formatQty(u.factorToBase)})` : ''}
        </option>
      ))}
    </NativeSelect>
  );
}

/** Default unit of the product for sales or purchases, once it is loaded. */
function useDefaultUnit(productId: string, kind: 'sale' | 'purchase'): string {
  const product = useProduct(productId);
  const unit = product.data?.units.find((u) =>
    kind === 'sale' ? u.isDefaultSale : u.isDefaultPurchase,
  );
  return unit?.unitId ?? product.data?.baseUnitId ?? '';
}

export function AdjustDialog({ productId, productName, open, onOpenChange }: DialogProps) {
  const t = useTranslations('stock');
  const tr = useTranslations('adjustmentReasons');
  const key = useIdempotencyKey(open);
  const defaultUnit = useDefaultUnit(productId, 'sale');
  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const [unitId, setUnitId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState<AdjustmentReason>('CASSE');
  const [note, setNote] = useState('');
  const mutation = useStockMutation(productId, (result) => {
    toast.success(t('adjustDone'));
    for (const w of result.warnings)
      toast.warning(t('negativeWarning', { after: formatQty(w.after) }));
    onOpenChange(false);
    setQuantity('');
    setNote('');
  });
  const parsed = parseDA(quantity);
  const valid = parsed !== null && parsed.gt(0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid || mutation.isPending) return;
            mutation.mutate({
              path: '/stock/adjustments',
              key,
              body: {
                reason,
                note: note.trim() || undefined,
                lines: [
                  {
                    productId,
                    unitId: unitId || defaultUnit,
                    qty: direction === 'out' ? `-${parsed.toString()}` : parsed.toString(),
                  },
                ],
              },
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('adjustTitle')}</DialogTitle>
            <DialogDescription>
              {productName}. {t('adjustHelp')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="adj-direction">{t('direction')}</Label>
              <NativeSelect
                id="adj-direction"
                value={direction}
                onChange={(e) => setDirection(e.target.value as 'out' | 'in')}
              >
                <option value="out">{t('directionOut')}</option>
                <option value="in">{t('directionIn')}</option>
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="adj-reason">{t('reason')}</Label>
              <NativeSelect
                id="adj-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value as AdjustmentReason)}
              >
                {ADJUSTMENT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {tr(r)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="adj-qty">{t('qty')}</Label>
              <Input
                id="adj-qty"
                dir="ltr"
                inputMode="decimal"
                autoFocus
                className="num"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adj-unit">{t('unit')}</Label>
              <UnitSelect
                id="adj-unit"
                productId={productId}
                value={unitId || defaultUnit}
                onChange={setUnitId}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="adj-note">{t('note')}</Label>
              <Input
                id="adj-note"
                maxLength={255}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={!valid || mutation.isPending}>
              {mutation.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {mutation.isPending ? t('saving') : t('adjustSubmit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function OpeningDialog({ productId, productName, open, onOpenChange }: DialogProps) {
  const t = useTranslations('stock');
  const key = useIdempotencyKey(open);
  const defaultUnit = useDefaultUnit(productId, 'purchase');
  const [unitId, setUnitId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [cost, setCost] = useState('');
  const mutation = useStockMutation(productId, () => {
    toast.success(t('openingDone'));
    onOpenChange(false);
  });
  const q = parseDA(quantity);
  const c = parseDA(cost);
  const valid = q !== null && q.gt(0) && c !== null && !c.isNegative();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid || mutation.isPending) return;
            mutation.mutate({
              path: '/stock/opening',
              key,
              body: {
                lines: [
                  {
                    productId,
                    unitId: unitId || defaultUnit,
                    qty: q.toString(),
                    unitCost: c.toString(),
                  },
                ],
              },
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('openingTitle')}</DialogTitle>
            <DialogDescription>
              {productName}. {t('openingHelp')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="open-qty">{t('qty')}</Label>
              <Input
                id="open-qty"
                dir="ltr"
                inputMode="decimal"
                autoFocus
                className="num"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="open-unit">{t('unit')}</Label>
              <UnitSelect
                id="open-unit"
                productId={productId}
                value={unitId || defaultUnit}
                onChange={setUnitId}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="open-cost">{t('unitCost')}</Label>
              <Input
                id="open-cost"
                dir="ltr"
                inputMode="decimal"
                className="num"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={!valid || mutation.isPending}>
              {mutation.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {mutation.isPending ? t('saving') : t('openingSubmit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
