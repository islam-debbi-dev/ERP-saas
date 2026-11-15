'use client';

import { useMutation } from '@tanstack/react-query';
import { ClipboardList, Loader2, Plus, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  DELIVERY_ACTIVITIES,
  Feature,
  ORDER_STATUSES,
  type OrderDto,
  type OrderStatus,
  type OrderSummaryDto,
} from '@erp/shared';
import { ClientPicker } from '@/components/sales/client-picker';
import { Amount } from '@/components/shared/amount';
import { EmptyState } from '@/components/shared/empty-state';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { useOrderPages } from '@/lib/tournees';
import { useErrorMessage } from '@/lib/use-error-message';
import { cn } from '@/lib/utils';
import { NativeSelect } from '@/components/ui/native-select';
import { VehicleCode, vehicleLabel } from '@/components/vehicles/vehicle-code';
import { useVehicles } from '@/lib/vehicles';
import { OrderStatusBadge } from './order-status-badge';

/** Bons de commande (pré-vente, phase 16). */
export function OrdersList() {
  return (
    <FeatureGate feature={Feature.TOURNEES}>
      <Orders />
    </FeatureGate>
  );
}

function Orders() {
  const t = useTranslations('orders');
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [status, setStatus] = useState<OrderStatus | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const role = useAuth().state.user?.role;
  const canCreate = role !== 'STOREKEEPER' && role !== 'LIVREUR';
  // Phase 36: the orders of one delivery truck.
  const tv = useTranslations('vehicles');
  const vehicles = useVehicles();
  const [deliveryVehicleId, setDeliveryVehicleId] = useState('');
  const deliveryTrucks = (vehicles.data ?? []).filter(
    (v) => v.active && !!v.vehicleType && DELIVERY_ACTIVITIES.includes(v.vehicleType.activity),
  );
  const pages = useOrderPages({ status, deliveryVehicleId: deliveryVehicleId || undefined });

  const create = useMutation({
    mutationFn: (clientId: string) =>
      api.request<OrderDto>('/orders', {
        method: 'POST',
        body: { clientId, lines: [] },
        idempotencyKey: key,
      }),
    onSuccess: (o) => router.push(`/commandes/${o.id}`),
    onError: (err) => {
      setKey(crypto.randomUUID());
      toast.error(errorMessage(err));
    },
  });

  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          canCreate ? (
            <Button onClick={() => setPicking(true)} disabled={create.isPending}>
              {create.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Plus aria-hidden />
              )}
              {t('new')}
            </Button>
          ) : null
        }
      />

      <StatusFilter value={status} onChange={setStatus} />

      {deliveryTrucks.length > 0 && role !== 'LIVREUR' ? (
        <NativeSelect
          aria-label={tv('deliveryVehicle')}
          className="sm:max-w-xs"
          value={deliveryVehicleId}
          onChange={(e) => setDeliveryVehicleId(e.target.value)}
        >
          <option value="">{`${tv('deliveryVehicle')} : ${tv('allVehicles')}`}</option>
          {deliveryTrucks.map((v) => (
            <option key={v.id} value={v.id}>
              {vehicleLabel(v)}
            </option>
          ))}
        </NativeSelect>
      ) : null}

      <OrderCards
        items={items}
        pending={pages.isPending}
        error={pages.isError ? errorMessage(pages.error) : null}
      />

      {pages.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => void pages.fetchNextPage()}
            disabled={pages.isFetchingNextPage}
          >
            {pages.isFetchingNextPage ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t('loadMore')}
          </Button>
        </div>
      ) : null}

      <ClientPicker
        open={picking}
        onOpenChange={setPicking}
        withCounter={false}
        onPick={(c) => {
          if (c) create.mutate(c.id);
        }}
      />
    </>
  );
}

export function StatusFilter({
  value,
  onChange,
}: {
  value: OrderStatus | undefined;
  onChange: (status: OrderStatus | undefined) => void;
}) {
  const t = useTranslations('orders');
  const options: (OrderStatus | undefined)[] = [undefined, ...ORDER_STATUSES];
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={t('filterStatus')}>
      {options.map((s) => (
        <button
          key={s ?? 'all'}
          type="button"
          aria-pressed={value === s}
          onClick={() => onChange(s)}
          className={cn(
            'min-h-11 shrink-0 rounded-full border px-4 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            value === s
              ? 'border-primary bg-primary text-primary-foreground'
              : 'bg-background hover:bg-muted',
          )}
        >
          {s ? t(`status${s}`) : t('all')}
        </button>
      ))}
    </div>
  );
}

export function OrderCards({
  items,
  pending,
  error,
  hrefOf = (o) => `/commandes/${o.id}`,
  emptyTitle,
  emptyDescription,
}: {
  items: OrderSummaryDto[];
  pending: boolean;
  error: string | null;
  hrefOf?: (o: OrderSummaryDto) => string;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const t = useTranslations('orders');
  const format = useFormatter();
  return (
    <Card className="p-0">
      {pending ? (
        <div className="space-y-2 p-4" aria-busy>
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : error ? (
        <p role="alert" className="p-4 text-sm text-destructive">
          {error}
        </p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={emptyTitle ?? t('emptyTitle')}
          description={emptyDescription ?? t('emptyDescription')}
        />
      ) : (
        <ul className="divide-y">
          {items.map((o) => (
            <li key={o.id}>
              <Link
                href={hrefOf(o)}
                className="flex min-h-16 items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium" title={o.client.name}>
                    {o.client.name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {o.number ? (
                      <span dir="ltr" className="num">
                        {o.number}
                      </span>
                    ) : (
                      t('draft')
                    )}
                    {o.requestedDate
                      ? ` · ${t('deliverOn', { date: format.dateTime(new Date(`${o.requestedDate}T12:00:00Z`), { dateStyle: 'short' }) })}`
                      : ''}
                    {o.livreur ? ` · ${o.livreur.fullName}` : ''}
                    {o.deliveryVehicle ? (
                      <>
                        {' · '}
                        <VehicleCode code={o.deliveryVehicle.code ?? o.deliveryVehicle.name} />
                      </>
                    ) : null}
                  </p>
                  {o.shortLines > 0 ? (
                    <p className="mt-1 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                      <TriangleAlert className="size-3.5" aria-hidden />
                      {t('shortLines', { count: o.shortLines })}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Amount value={o.totalTtc} className="text-sm font-medium" />
                  <OrderStatusBadge status={o.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
