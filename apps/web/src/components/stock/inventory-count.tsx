'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Loader2, ScanBarcode, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { type InventoryDto, parseDA, Permission, type ProductDto, qty } from '@erp/shared';
import { PageHeader } from '@/components/shared/page-header';
import { StickyActions } from '@/components/shared/sticky-actions';
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
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { usePermission } from '@/lib/auth';
import { findProductByCode, useUnitLabel } from '@/lib/catalog';
import { formatQty, stockKeys, useInventory } from '@/lib/stock';
import { useErrorMessage } from '@/lib/use-error-message';
import { cn } from '@/lib/utils';
import { InventoryStatusBadge } from './inventories-list';

interface Entry {
  product: ProductDto;
  unitId: string;
  qty: string;
}

export function InventoryCount({ id }: { id: string }) {
  const t = useTranslations('inventory');
  const canValidate = usePermission(Permission.STOCK_ADJUST);
  // A blind count: without STOCK_ADJUST the API sends no expected quantity nor écart.
  const showExpected = canValidate;
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const unitLabel = useUnitLabel();
  const queryClient = useQueryClient();
  const inventory = useInventory(id);
  const scanRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [looking, setLooking] = useState(false);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [closeKeys] = useState(() => ({
    validate: crypto.randomUUID(),
    cancel: crypto.randomUUID(),
  }));

  const inv = inventory.data;
  const open = inv?.status === 'OPEN';
  const cols = 2 + (showExpected ? 2 : 0) + (open ? 1 : 0);

  useEffect(() => {
    if (entry) qtyRef.current?.focus();
  }, [entry]);

  const setInventory = (next: InventoryDto) => {
    queryClient.setQueryData(stockKeys.inventory(id), next);
    void queryClient.invalidateQueries({ queryKey: stockKeys.inventories });
  };

  const saveLine = useMutation({
    mutationFn: (line: { productId: string; unitId?: string; qty: string | null }) =>
      api.request<InventoryDto>(`/inventories/${id}/lines`, {
        method: 'PUT',
        body: { lines: [line] },
      }),
    onSuccess: (next, line) => {
      setInventory(next);
      if (line.qty !== null) toast.success(t('saved'));
      setEntry(null);
      setCode('');
      scanRef.current?.focus();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const close = useMutation({
    mutationFn: (action: 'validate' | 'cancel') =>
      api.request<InventoryDto>(`/inventories/${id}/${action}`, {
        method: 'POST',
        idempotencyKey: closeKeys[action],
      }),
    onSuccess: (next, action) => {
      setInventory(next);
      void queryClient.invalidateQueries({ queryKey: stockKeys.all });
      toast.success(action === 'validate' ? t('validated') : t('cancelled'));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  async function onScan() {
    const value = code.trim();
    if (!value) return;
    setLooking(true);
    try {
      const found = await findProductByCode(value);
      if (!found) {
        toast.error(t('notFound', { code: value }));
        setCode('');
        return;
      }
      const counted = inv?.lines.find((l) => l.productId === found.product.id);
      const factor =
        found.product.units.find((u) => u.unitId === found.unitId)?.factorToBase ?? '1';
      setEntry({
        product: found.product,
        unitId: found.unitId,
        // Re-scanning a counted product shows its count in the scanned unit.
        qty: counted ? qty(counted.countedQtyBase).div(factor).toDecimalPlaces(3).toString() : '',
      });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLooking(false);
    }
  }

  function saveEntry() {
    if (!entry) return;
    const parsed = parseDA(entry.qty);
    if (parsed === null || parsed.isNegative()) {
      qtyRef.current?.focus();
      return;
    }
    saveLine.mutate({ productId: entry.product.id, unitId: entry.unitId, qty: parsed.toString() });
  }

  if (inventory.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{errorMessage(inventory.error)}</AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      <PageHeader
        title={inv ? `${t('listTitle')} ${inv.number}` : t('listTitle')}
        description={t('scanHint')}
        actions={
          <>
            {inv ? <InventoryStatusBadge status={inv.status} /> : null}
            <Button asChild variant="ghost">
              <Link href="/stock/inventaires">
                <ArrowLeft className="rtl-flip" aria-hidden />
                {t('back')}
              </Link>
            </Button>
          </>
        }
      />

      {inv && !open ? (
        <Alert role="status">
          <AlertDescription>{t('readOnly')}</AlertDescription>
        </Alert>
      ) : null}

      {open ? (
        <Card className="py-4">
          <CardContent className="grid gap-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void onScan();
              }}
              className="space-y-2"
            >
              <Label htmlFor="scan">{t('scanLabel')}</Label>
              <div className="relative">
                {looking ? (
                  <Loader2
                    className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
                    aria-hidden
                  />
                ) : (
                  <ScanBarcode
                    className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                )}
                <Input
                  id="scan"
                  type="search"
                  enterKeyHint="search"
                  ref={scanRef}
                  autoFocus
                  autoComplete="off"
                  dir="ltr"
                  className="ps-9"
                  placeholder={t('scanPlaceholder')}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </div>
            </form>

            {entry ? (
              <form
                className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-[minmax(0,1fr)_10rem_9rem_auto] sm:items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveEntry();
                }}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{entry.product.designation}</p>
                  <p className="text-xs text-muted-foreground" dir="ltr">
                    {entry.product.reference}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="count-unit" className="text-xs">
                    {t('colCounted')}
                  </Label>
                  <NativeSelect
                    id="count-unit"
                    value={entry.unitId}
                    onChange={(e) => setEntry({ ...entry, unitId: e.target.value })}
                  >
                    {entry.product.units.map((u) => (
                      <option key={u.unitId} value={u.unitId}>
                        {unitLabel({ code: u.unitCode, name: u.unitName })}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <Input
                  ref={qtyRef}
                  aria-label={t('countIn', {
                    unit: unitLabel(
                      (() => {
                        const u = entry.product.units.find((x) => x.unitId === entry.unitId);
                        return u ? { code: u.unitCode, name: u.unitName } : undefined;
                      })(),
                    ),
                  })}
                  dir="ltr"
                  inputMode="decimal"
                  className="num"
                  value={entry.qty}
                  onChange={(e) => setEntry({ ...entry, qty: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setEntry(null);
                      scanRef.current?.focus();
                    }
                  }}
                />
                <div className="flex gap-1">
                  <Button
                    type="submit"
                    size="icon"
                    aria-label={tc('save')}
                    disabled={saveLine.isPending}
                  >
                    {saveLine.isPending ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : (
                      <Check aria-hidden />
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t('keep')}
                    onClick={() => {
                      setEntry(null);
                      scanRef.current?.focus();
                    }}
                  >
                    <X aria-hidden />
                  </Button>
                </div>
              </form>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="stack-table w-full min-w-[34rem] text-sm">
          <caption className="sr-only">{t('listTitle')}</caption>
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="p-3 text-start font-medium">{t('colProduct')}</th>
              <th className="p-3 text-end font-medium">{t('colCounted')}</th>
              {showExpected ? (
                <>
                  <th className="p-3 text-end font-medium">{t('colExpected')}</th>
                  <th className="p-3 text-end font-medium">{t('colDiff')}</th>
                </>
              ) : null}
              {open ? <th className="w-12 p-3" /> : null}
            </tr>
          </thead>
          <tbody>
            {!inv ? (
              <tr>
                <td colSpan={cols} className="p-3">
                  <Skeleton className="h-6 w-full" />
                </td>
              </tr>
            ) : inv.lines.length === 0 ? (
              <tr>
                <td colSpan={cols} className="p-8 text-center text-muted-foreground">
                  {t('emptyLines')}
                </td>
              </tr>
            ) : (
              inv.lines.map((l) => {
                const diff = l.diffQtyBase === null ? null : qty(l.diffQtyBase);
                return (
                  <tr key={l.productId} className="border-t">
                    <td className="p-3" data-cell="main">
                      <p className="font-medium">{l.designation}</p>
                      <p className="text-xs text-muted-foreground" dir="ltr">
                        {l.reference}
                      </p>
                    </td>
                    <td className="num p-3 text-end" data-label={t('colCounted')}>
                      <bdi dir="ltr">{formatQty(l.countedQtyBase)}</bdi>
                    </td>
                    {showExpected &&
                    l.expectedQtyBase !== null &&
                    l.diffQtyBase !== null &&
                    diff !== null ? (
                      <>
                        <td
                          className="num p-3 text-end text-muted-foreground"
                          data-label={t('colExpected')}
                        >
                          <bdi dir="ltr">{formatQty(l.expectedQtyBase)}</bdi>
                        </td>
                        <td
                          className={cn(
                            'num p-3 text-end font-medium',
                            diff.gt(0) && 'text-primary',
                            diff.lt(0) && 'text-destructive',
                          )}
                          data-label={t('colDiff')}
                        >
                          <bdi dir="ltr">{formatQty(l.diffQtyBase, { signed: true })}</bdi>
                        </td>
                      </>
                    ) : showExpected ? (
                      <>
                        <td className="p-3" />
                        <td className="p-3" />
                      </>
                    ) : null}
                    {open ? (
                      <td className="p-3" data-cell="actions">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`${t('remove')} ${l.designation}`}
                          onClick={() => saveLine.mutate({ productId: l.productId, qty: null })}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {open ? (
        <StickyActions className="justify-between md:sticky md:bottom-0 md:z-20 md:-mx-4 md:border-t md:bg-background/95 md:px-4 md:py-3 md:backdrop-blur lg:-mx-6 lg:px-6">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={close.isPending}>
                {t('cancelInventory')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('cancelTitle')}</AlertDialogTitle>
                <AlertDialogDescription>{t('cancelBody')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('keep')}</AlertDialogCancel>
                <AlertDialogAction onClick={() => close.mutate('cancel')}>
                  {t('cancelInventory')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                disabled={close.isPending || !inv || inv.lines.length === 0 || !canValidate}
                title={canValidate ? undefined : t('validateNeedsPermission')}
              >
                {close.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Check aria-hidden />
                )}
                {t('validate')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('validateTitle')}</AlertDialogTitle>
                <AlertDialogDescription>{t('validateBody')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('keep')}</AlertDialogCancel>
                <AlertDialogAction onClick={() => close.mutate('validate')}>
                  {t('validate')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </StickyActions>
      ) : null}
    </>
  );
}
