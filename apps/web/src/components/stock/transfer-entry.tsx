'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Loader2, ScanBarcode, Trash2, Undo2, X } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Feature,
  parseDA,
  type ProductDto,
  qty,
  type StockTransferDto,
  type StockTransferResultDto,
} from '@erp/shared';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
import { PrintButton } from '@/components/shared/print-button';
import { StickyActions } from '@/components/shared/sticky-actions';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { findProductByCode, useUnitLabel } from '@/lib/catalog';
import { formatQty, saveTransfer, stockKeys, useStockLevel, useTransfer } from '@/lib/stock';
import { useErrorMessage } from '@/lib/use-error-message';
import { TransferStatusBadge } from './transfers-list';

interface Entry {
  product: ProductDto;
  unitId: string;
  qty: string;
}

/** A barcode keeps the unit it belongs to; a reference counts in the biggest packaging. */
function entryUnit(product: ProductDto, code: string, found: string): string {
  if (product.units.some((u) => u.barcode === code)) return found;
  const biggest = [...product.units].sort((a, b) =>
    qty(b.factorToBase).cmp(qty(a.factorToBase)),
  )[0];
  return biggest?.unitId ?? found;
}

/** Stock > Transferts > one bon: scan, Enter, quantity in cartons, Enter. */
export function TransferEntry({ id }: { id: string }) {
  return (
    <FeatureGate feature={Feature.WAREHOUSES}>
      <Entry id={id} />
    </FeatureGate>
  );
}

function Entry({ id }: { id: string }) {
  const t = useTranslations('transfers');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const unitLabel = useUnitLabel();
  const queryClient = useQueryClient();
  const transfer = useTransfer(id);
  const scanRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [looking, setLooking] = useState(false);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [reason, setReason] = useState('');
  const [keys] = useState(() => ({ validate: crypto.randomUUID(), cancel: crypto.randomUUID() }));

  const tr = transfer.data;
  const draft = tr?.status === 'DRAFT';
  const level = useStockLevel(entry?.product.id ?? '');
  const available = level.data?.byWarehouse?.find((w) => w.warehouseId === tr?.from.id)?.qtyBase;

  // Quantity selected when a product is found; back to the scan field once it is added.
  useEffect(() => {
    if (entry) qtyRef.current?.select();
    else if (draft) scanRef.current?.focus();
  }, [entry, draft]);

  const store = (next: StockTransferDto) => {
    queryClient.setQueryData(stockKeys.transfer(id), next);
    void queryClient.invalidateQueries({ queryKey: stockKeys.transfers });
  };

  const save = useMutation({
    mutationFn: (lines: { productId: string; unitId: string; qty: string }[]) => {
      if (!tr) throw new Error('transfer not loaded');
      return saveTransfer(id, {
        type: tr.type,
        fromWarehouseId: tr.from.id,
        toWarehouseId: tr.to.id,
        note: tr.note ?? undefined,
        lines,
      });
    },
    onSuccess: (next) => {
      store(next);
      setEntry(null);
      setCode('');
      scanRef.current?.focus();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const close = useMutation({
    mutationFn: (action: 'validate' | 'cancel') =>
      api.request<StockTransferResultDto>(`/stock-transfers/${id}/${action}`, {
        method: 'POST',
        body: action === 'cancel' ? { reason } : {},
        idempotencyKey: keys[action],
      }),
    onSuccess: (res, action) => {
      store(res.transfer);
      void queryClient.invalidateQueries({ queryKey: stockKeys.all });
      toast.success(action === 'validate' ? t('validated') : t('cancelled'));
      if (res.warnings.length > 0)
        toast.warning(t('negativeWarning', { count: res.warnings.length }));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const current = () =>
    (tr?.lines ?? []).map((l) => ({ productId: l.productId, unitId: l.unitId, qty: l.qty }));

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
      const unitId = entryUnit(found.product, value, found.unitId);
      setEntry({ product: found.product, unitId, qty: '1' });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLooking(false);
    }
  }

  /** Adds to the line of the same product and unit; another unit replaces the line. */
  function addEntry() {
    if (!entry) return;
    const parsed = parseDA(entry.qty);
    if (parsed === null || !parsed.gt(0)) {
      qtyRef.current?.focus();
      return;
    }
    const lines = current();
    const same = lines.find((l) => l.productId === entry.product.id);
    const next =
      same && same.unitId === entry.unitId
        ? lines.map((l) => (l === same ? { ...l, qty: qty(l.qty).plus(parsed).toString() } : l))
        : [
            ...lines.filter((l) => l.productId !== entry.product.id),
            { productId: entry.product.id, unitId: entry.unitId, qty: parsed.toString() },
          ];
    save.mutate(next);
  }

  if (transfer.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{errorMessage(transfer.error)}</AlertDescription>
      </Alert>
    );
  }

  const entryUnitDto = entry?.product.units.find((u) => u.unitId === entry.unitId);

  return (
    <>
      <PageHeader
        title={tr ? `${t(`type${tr.type}`)}${tr.number ? ` ${tr.number}` : ''}` : t('title')}
        description={tr ? t('route', { from: tr.from.name, to: tr.to.name }) : undefined}
        actions={
          <>
            {tr ? <TransferStatusBadge status={tr.status} /> : null}
            {tr && tr.status !== 'DRAFT' ? (
              <PrintButton path={`/documents/TR/${tr.id}/pdf`} fileName={tr.number ?? undefined} />
            ) : null}
            <Button asChild variant="ghost">
              <Link href="/stock/transferts">
                <ArrowLeft className="rtl-flip" aria-hidden />
                {t('back')}
              </Link>
            </Button>
          </>
        }
      />

      {tr && !draft ? (
        <Alert role="status">
          <AlertDescription>
            {tr.status === 'CANCELLED' && tr.cancelReason
              ? t('cancelledBecause', { reason: tr.cancelReason })
              : t('readOnly')}
          </AlertDescription>
        </Alert>
      ) : null}

      {draft ? (
        <Card className="py-4">
          <CardContent className="grid gap-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void onScan();
              }}
              className="space-y-2"
            >
              <Label htmlFor="transfer-scan">{t('scanLabel')}</Label>
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
                  id="transfer-scan"
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
                  addEntry();
                }}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{entry.product.designation}</p>
                  <p className="text-xs text-muted-foreground">
                    <span dir="ltr">{entry.product.reference}</span>
                    {available !== undefined ? (
                      <>
                        {' · '}
                        {t('available', { from: tr?.from.name ?? '' })}{' '}
                        <bdi dir="ltr" className="num">
                          {formatQty(available)}
                        </bdi>
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="transfer-unit" className="text-xs">
                    {t('unit')}
                  </Label>
                  <NativeSelect
                    id="transfer-unit"
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
                  aria-label={t('qtyIn', {
                    unit: unitLabel(
                      entryUnitDto
                        ? { code: entryUnitDto.unitCode, name: entryUnitDto.unitName }
                        : undefined,
                    ),
                  })}
                  dir="ltr"
                  inputMode="decimal"
                  enterKeyHint="done"
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
                    className="size-11"
                    aria-label={t('add')}
                    disabled={save.isPending}
                  >
                    {save.isPending ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : (
                      <Check aria-hidden />
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-11"
                    aria-label={tc('cancel')}
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
        <table className="stack-table w-full text-sm">
          <caption className="sr-only">{t('title')}</caption>
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="p-3 text-start font-medium">{t('colProduct')}</th>
              <th className="p-3 text-end font-medium">{t('colQty')}</th>
              <th className="p-3 text-end font-medium">{t('colBase')}</th>
              {draft ? <th className="w-12 p-3" /> : null}
            </tr>
          </thead>
          <tbody>
            {!tr ? (
              <tr>
                <td colSpan={4} className="p-3">
                  <Skeleton className="h-6 w-full" />
                </td>
              </tr>
            ) : tr.lines.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-8 text-center text-muted-foreground">
                  {t('emptyLines')}
                </td>
              </tr>
            ) : (
              tr.lines.map((l) => (
                <tr key={l.productId} className="border-t">
                  <td className="p-3" data-cell="main">
                    <p className="font-medium">{l.designation}</p>
                    <p className="text-xs text-muted-foreground" dir="ltr">
                      {l.reference}
                    </p>
                  </td>
                  <td className="num p-3 text-end font-medium" data-label={t('colQty')}>
                    <bdi dir="ltr">{formatQty(l.qty)}</bdi>{' '}
                    {unitLabel({ code: l.unitCode, name: null })}
                  </td>
                  <td className="num p-3 text-end text-muted-foreground" data-label={t('colBase')}>
                    <bdi dir="ltr">{formatQty(l.qtyBase)}</bdi>
                  </td>
                  {draft ? (
                    <td className="p-3" data-cell="actions">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11"
                        aria-label={t('removeNamed', { name: l.designation })}
                        disabled={save.isPending}
                        onClick={() =>
                          save.mutate(current().filter((x) => x.productId !== l.productId))
                        }
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {tr && tr.status !== 'CANCELLED' ? (
        <StickyActions className="justify-between md:sticky md:bottom-0 md:z-20 md:-mx-4 md:border-t md:bg-background/95 md:px-4 md:py-3 md:backdrop-blur lg:-mx-6 lg:px-6">
          <AlertDialog onOpenChange={(o) => o && setReason('')}>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={close.isPending}>
                {draft ? (
                  t('abandon')
                ) : (
                  <>
                    <Undo2 aria-hidden />
                    {t('reverse')}
                  </>
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{draft ? t('abandonTitle') : t('reverseTitle')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {draft ? t('abandonBody') : t('reverseBody')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-2">
                <Label htmlFor="transfer-reason">{t('reason')}</Label>
                <Input
                  id="transfer-reason"
                  value={reason}
                  maxLength={255}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>{tc('cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  disabled={reason.trim().length < 3}
                  onClick={() => close.mutate('cancel')}
                >
                  {draft ? t('abandon') : t('reverse')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {draft ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={close.isPending || save.isPending || tr.lines.length === 0}>
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
                  <AlertDialogDescription>
                    {t('validateBody', {
                      count: tr.lines.length,
                      from: tr.from.name,
                      to: tr.to.name,
                    })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{tc('cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => close.mutate('validate')}>
                    {t('validate')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </StickyActions>
      ) : null}
    </>
  );
}
