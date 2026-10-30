'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  Loader2,
  PackageCheck,
  ScanBarcode,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Feature,
  type OrderDto,
  OFFICE_ROLES,
  parseDA,
  type ProductDto,
  qty,
  type SaleLineInput,
} from '@erp/shared';
import { Amount } from '@/components/shared/amount';
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
import { useAuth } from '@/lib/auth';
import { findProductByCode, useUnitLabel } from '@/lib/catalog';
import { formatQty } from '@/lib/stock';
import { saveOrder, tourneeKeys, useDeliverers, useOrder } from '@/lib/tournees';
import { useErrorMessage } from '@/lib/use-error-message';
import { DeliverDialog } from './deliver-dialog';
import { OrderStatusBadge } from './order-status-badge';

interface Entry {
  product: ProductDto;
  unitId: string;
  qty: string;
}

/** Bon de commande: a draft to fill, then confirm, put on a livreur, deliver. */
export function OrderView({ id, backHref = '/commandes' }: { id: string; backHref?: string }) {
  return (
    <FeatureGate feature={Feature.TOURNEES}>
      <View id={id} backHref={backHref} />
    </FeatureGate>
  );
}

function View({ id, backHref }: { id: string; backHref: string }) {
  const t = useTranslations('orders');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const unitLabel = useUnitLabel();
  const queryClient = useQueryClient();
  const order = useOrder(id);
  const role = useAuth().state.user?.role;
  const planner = !!role && OFFICE_ROLES.includes(role);
  const deliverers = useDeliverers(planner);
  const scanRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [looking, setLooking] = useState(false);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [reason, setReason] = useState('');
  const [delivering, setDelivering] = useState(false);
  const [keys] = useState(() => ({ confirm: crypto.randomUUID(), cancel: crypto.randomUUID() }));

  const o = order.data;
  const draft = o?.status === 'DRAFT';
  const canDeliver = o?.status === 'CONFIRMED' && role !== 'STOREKEEPER';

  useEffect(() => {
    if (entry) qtyRef.current?.select();
  }, [entry]);

  const store = (next: OrderDto) => {
    queryClient.setQueryData(tourneeKeys.order(id), next);
    void queryClient.invalidateQueries({ queryKey: tourneeKeys.orders });
  };

  const current = (): SaleLineInput[] =>
    (o?.lines ?? []).map((l) => ({
      productId: l.productId,
      unitId: l.unitId,
      qty: l.qty,
      discountPct: l.discountPct,
    }));

  const save = useMutation({
    mutationFn: (patch: { lines?: SaleLineInput[]; requestedDate?: string | null }) => {
      if (!o) throw new Error('order not loaded');
      return saveOrder(id, {
        clientId: o.client.id,
        warehouseId: o.warehouse?.id ?? null,
        requestedDate: patch.requestedDate !== undefined ? patch.requestedDate : o.requestedDate,
        note: o.note,
        lines: patch.lines ?? current(),
        version: o.version,
      });
    },
    onSuccess: (next) => {
      store(next);
      setEntry(null);
      setCode('');
      scanRef.current?.focus();
    },
    onError: (err) => {
      toast.error(errorMessage(err));
      void order.refetch();
    },
  });

  const act = useMutation({
    mutationFn: (action: 'confirm' | 'cancel') =>
      api.request<OrderDto>(`/orders/${id}/${action}`, {
        method: 'POST',
        body: action === 'cancel' ? { reason } : {},
        idempotencyKey: keys[action],
      }),
    onSuccess: (next, action) => {
      store(next);
      toast.success(action === 'confirm' ? t('confirmed') : t('cancelled'));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const assign = useMutation({
    mutationFn: (livreurId: string | null) =>
      api.request<OrderDto>(`/orders/${id}/livreur`, { method: 'PATCH', body: { livreurId } }),
    onSuccess: (next) => {
      store(next);
      toast.success(t('livreurSaved'));
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
      setEntry({ product: found.product, unitId: found.unitId, qty: '1' });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLooking(false);
    }
  }

  function addEntry() {
    if (!entry) return;
    const parsed = parseDA(entry.qty);
    if (parsed === null || !parsed.gt(0)) {
      qtyRef.current?.focus();
      return;
    }
    const lines = current();
    const same = lines.find((l) => l.productId === entry.product.id && l.unitId === entry.unitId);
    save.mutate({
      lines: same
        ? lines.map((l) => (l === same ? { ...l, qty: qty(l.qty).plus(parsed).toString() } : l))
        : [
            ...lines,
            {
              productId: entry.product.id,
              unitId: entry.unitId,
              qty: parsed.toString(),
              discountPct: '0',
            },
          ],
    });
  }

  if (order.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{errorMessage(order.error)}</AlertDescription>
      </Alert>
    );
  }
  if (!o) {
    return (
      <>
        <PageHeader title={t('title')} />
        <Skeleton className="h-64 w-full" aria-busy />
      </>
    );
  }

  const short = o.lines.filter((l) => qty(l.availableBase).lt(l.qtyBase));

  return (
    <>
      <PageHeader
        title={o.number ? `${t('orderOne')} ${o.number}` : t('draftTitle')}
        description={o.client.name}
        actions={
          <>
            <OrderStatusBadge status={o.status} />
            {!draft ? (
              <PrintButton path={`/documents/BC/${o.id}/pdf`} fileName={o.number ?? undefined} />
            ) : null}
            <Button asChild variant="ghost">
              <Link href={backHref}>
                <ArrowLeft className="rtl-flip" aria-hidden />
                {t('back')}
              </Link>
            </Button>
          </>
        }
      />

      {o.status === 'CANCELLED' ? (
        <Alert role="status">
          <AlertDescription>
            {t('cancelledBecause', { reason: o.cancelReason ?? '' })}
          </AlertDescription>
        </Alert>
      ) : null}
      {o.status === 'DELIVERED' && o.sale ? (
        <Alert role="status">
          <AlertDescription>
            {t('deliveredBy')}{' '}
            <Link href={`/ventes/${o.sale.id}`} className="font-medium underline" dir="ltr">
              {o.sale.number}
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="py-4">
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1 text-sm">
            <p className="text-muted-foreground">{t('seller')}</p>
            <p className="font-medium">{o.seller?.fullName ?? '—'}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="order-date">{t('requestedDate')}</Label>
            <Input
              id="order-date"
              type="date"
              value={o.requestedDate ?? ''}
              disabled={!draft || save.isPending}
              onChange={(e) => save.mutate({ requestedDate: e.target.value || null })}
            />
          </div>
          {o.status === 'CONFIRMED' && planner ? (
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="order-livreur">{t('livreur')}</Label>
              <NativeSelect
                id="order-livreur"
                value={o.livreur?.id ?? ''}
                disabled={assign.isPending}
                onChange={(e) => assign.mutate(e.target.value || null)}
              >
                <option value="">{t('noLivreur')}</option>
                {(deliverers.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : o.livreur ? (
            <div className="space-y-1 text-sm">
              <p className="text-muted-foreground">{t('livreur')}</p>
              <p className="font-medium">{o.livreur.fullName}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

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
              <Label htmlFor="order-scan">{t('scanLabel')}</Label>
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
                  id="order-scan"
                  type="search"
                  enterKeyHint="search"
                  ref={scanRef}
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
                  <p className="text-xs text-muted-foreground" dir="ltr">
                    {entry.product.reference}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="order-unit" className="text-xs">
                    {t('unit')}
                  </Label>
                  <NativeSelect
                    id="order-unit"
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
                  aria-label={t('qty')}
                  dir="ltr"
                  inputMode="decimal"
                  enterKeyHint="done"
                  className="num"
                  value={entry.qty}
                  onChange={(e) => setEntry({ ...entry, qty: e.target.value })}
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
                    onClick={() => setEntry(null)}
                  >
                    <X aria-hidden />
                  </Button>
                </div>
              </form>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {o.status === 'CONFIRMED' && short.length > 0 ? (
        <Alert>
          <TriangleAlert aria-hidden />
          <AlertDescription>{t('shortWarning', { count: short.length })}</AlertDescription>
        </Alert>
      ) : null}

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="stack-table w-full text-sm">
          <caption className="sr-only">{t('lines')}</caption>
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="p-3 text-start font-medium">{t('colProduct')}</th>
              <th className="p-3 text-end font-medium">{t('colQty')}</th>
              <th className="p-3 text-end font-medium">{t('colPrice')}</th>
              <th className="p-3 text-end font-medium">{t('colAmount')}</th>
              <th className="p-3 text-end font-medium">
                {o.status === 'DELIVERED' ? t('colDelivered') : t('colAvailable')}
              </th>
              {draft ? <th className="w-12 p-3" /> : null}
            </tr>
          </thead>
          <tbody>
            {o.lines.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">
                  {t('emptyLines')}
                </td>
              </tr>
            ) : (
              o.lines.map((l) => {
                const lacking = qty(l.availableBase).lt(l.qtyBase);
                return (
                  <tr key={l.id} className="border-t">
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
                    <td className="p-3 text-end" data-label={t('colPrice')}>
                      <Amount value={l.unitPriceHt} currency={false} />
                    </td>
                    <td className="p-3 text-end" data-label={t('colAmount')}>
                      <Amount value={l.lineHt} currency={false} />
                    </td>
                    <td
                      className="num p-3 text-end"
                      data-label={o.status === 'DELIVERED' ? t('colDelivered') : t('colAvailable')}
                    >
                      {o.status === 'DELIVERED' ? (
                        <span>
                          <bdi dir="ltr">{formatQty(l.qtyDelivered ?? '0')}</bdi>
                          {l.qtyNotDelivered && qty(l.qtyNotDelivered).gt(0) ? (
                            <span className="ms-1 text-amber-700 dark:text-amber-400">
                              ({t('notDelivered', { qty: formatQty(l.qtyNotDelivered) })})
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span
                          className={
                            lacking && o.status === 'CONFIRMED'
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-muted-foreground'
                          }
                        >
                          <bdi dir="ltr">{formatQty(l.availableBase)}</bdi>
                          {lacking && o.status === 'CONFIRMED' ? (
                            <span className="sr-only"> {t('notEnough')}</span>
                          ) : null}
                        </span>
                      )}
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
                            save.mutate({
                              lines: current().filter(
                                (x) => !(x.productId === l.productId && x.unitId === l.unitId),
                              ),
                            })
                          }
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
          {o.lines.length > 0 ? (
            <tfoot>
              <tr className="border-t font-semibold">
                <td className="p-3" data-cell="main">
                  {t('totalTtc')}
                </td>
                <td colSpan={5} className="p-3 text-end" data-cell="end">
                  <Amount value={o.totalTtc} />
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {draft || canDeliver ? (
        <StickyActions className="justify-between md:sticky md:bottom-0 md:z-20 md:-mx-4 md:border-t md:bg-background/95 md:px-4 md:py-3 md:backdrop-blur lg:-mx-6 lg:px-6">
          {role !== 'LIVREUR' ? (
            <AlertDialog onOpenChange={(open) => open && setReason('')}>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={act.isPending}>
                  {t('cancel')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('cancelTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>{t('cancelBody')}</AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="order-reason">{t('reason')}</Label>
                  <Input
                    id="order-reason"
                    value={reason}
                    maxLength={255}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel>{tc('cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={reason.trim().length < 3}
                    onClick={() => act.mutate('cancel')}
                  >
                    {t('cancel')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
          {draft ? (
            <Button
              disabled={act.isPending || save.isPending || o.lines.length === 0}
              onClick={() => act.mutate('confirm')}
            >
              {act.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Check aria-hidden />
              )}
              {t('confirm')}
            </Button>
          ) : (
            <Button onClick={() => setDelivering(true)}>
              <PackageCheck aria-hidden />
              {t('deliver')}
            </Button>
          )}
        </StickyActions>
      ) : null}

      <DeliverDialog
        order={delivering ? o : null}
        onClose={() => setDelivering(false)}
        onDelivered={(next) => store(next)}
      />
    </>
  );
}
