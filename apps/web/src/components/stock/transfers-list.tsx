'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowLeftRight, Loader2, Plus, Warehouse } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  Feature,
  type StockTransferDto,
  type StockTransferStatus,
  StockTransferType,
  type WarehouseDto,
  WarehouseType,
} from '@erp/shared';
import { EmptyState } from '@/components/shared/empty-state';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { stockKeys, useTransferPages, useWarehouses } from '@/lib/stock';
import { useErrorMessage } from '@/lib/use-error-message';
import { WarehouseSelect } from './warehouse-select';

/** Same rule as the API: a load fills a truck, an unload empties one. */
export function transferTypeOf(
  from: WarehouseDto | undefined,
  to: WarehouseDto | undefined,
): StockTransferType {
  const fromTruck = from?.type === WarehouseType.VEHICLE;
  const toTruck = to?.type === WarehouseType.VEHICLE;
  if (toTruck && !fromTruck) return StockTransferType.LOAD;
  if (fromTruck && !toTruck) return StockTransferType.UNLOAD;
  return StockTransferType.TRANSFER;
}

export function TransferStatusBadge({ status }: { status: StockTransferStatus }) {
  const t = useTranslations('transfers');
  const variant = status === 'DRAFT' ? 'default' : status === 'VALIDATED' ? 'secondary' : 'outline';
  return <Badge variant={variant}>{t(`status${status}`)}</Badge>;
}

/** Stock > Transferts (phase 15): chargement / déchargement des camions. */
export function TransfersList() {
  return (
    <FeatureGate feature={Feature.WAREHOUSES}>
      <Transfers />
    </FeatureGate>
  );
}

function Transfers() {
  const t = useTranslations('transfers');
  const tc = useTranslations('common');
  const format = useFormatter();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const pages = useTransferPages();
  const warehouses = useWarehouses();
  const [creating, setCreating] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());

  const list = warehouses.data ?? [];
  const fromW = list.find((w) => w.id === from);
  const toW = list.find((w) => w.id === to);
  const type = transferTypeOf(fromW, toW);

  const open = () => {
    // Most transfers are a chargement: main dépôt → first truck.
    const main = list.find((w) => w.isDefault);
    const truck = list.find((w) => w.type === WarehouseType.VEHICLE && w.active);
    setFrom(main?.id ?? '');
    setTo(truck?.id ?? '');
    setKey(crypto.randomUUID());
    setCreating(true);
  };

  const create = useMutation({
    mutationFn: () =>
      api.request<StockTransferDto>('/stock-transfers', {
        method: 'POST',
        body: { type, fromWarehouseId: from, toWarehouseId: to, lines: [] },
        idempotencyKey: key,
      }),
    onSuccess: (tr) => {
      void queryClient.invalidateQueries({ queryKey: stockKeys.transfers });
      router.push(`/stock/transferts/${tr.id}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button onClick={open} disabled={warehouses.isPending}>
            <Plus aria-hidden />
            {t('new')}
          </Button>
        }
        more={[
          { label: t('warehouses'), icon: Warehouse, href: '/stock/depots' },
          { label: t('back'), icon: ArrowLeft, flipIcon: true, tone: 'ghost', href: '/stock' },
        ]}
      />

      <Card className="p-0">
        {pages.isPending ? (
          <div className="space-y-2 p-4" aria-busy>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : pages.isError ? (
          <p role="alert" className="p-4 text-sm text-destructive">
            {errorMessage(pages.error)}
          </p>
        ) : items.length === 0 ? (
          <EmptyState
            icon={ArrowLeftRight}
            title={t('emptyTitle')}
            description={t('emptyDescription')}
          />
        ) : (
          <ul className="divide-y">
            {items.map((tr) => (
              <li key={tr.id}>
                <Link
                  href={`/stock/transferts/${tr.id}`}
                  className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {t(`type${tr.type}`)}
                      {tr.number ? (
                        <span className="ms-2 tabular-nums text-muted-foreground" dir="ltr">
                          {tr.number}
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {t('route', { from: tr.from.name, to: tr.to.name })} ·{' '}
                      {t('lineCount', { count: tr.lineCount })} ·{' '}
                      {format.dateTime(new Date(tr.validatedAt ?? tr.createdAt), {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </p>
                  </div>
                  <TransferStatusBadge status={tr.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

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

      <ResponsiveDialog open={creating} onOpenChange={setCreating}>
        <ResponsiveDialogContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (from && to && from !== to) create.mutate();
            }}
          >
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>{t('new')}</ResponsiveDialogTitle>
              <ResponsiveDialogDescription>{t('newHelp')}</ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            <WarehouseSelect id="transfer-from" label={t('from')} value={from} onChange={setFrom} />
            <WarehouseSelect
              id="transfer-to"
              label={t('to')}
              value={to}
              onChange={setTo}
              excludeId={from}
            />
            {from && to ? (
              <p className="text-sm" role="status">
                {t('typeIs')} <span className="font-medium">{t(`type${type}`)}</span>
              </p>
            ) : null}
            <ResponsiveDialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                {tc('cancel')}
              </Button>
              <Button type="submit" disabled={create.isPending || !from || !to || from === to}>
                {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {t('start')}
              </Button>
            </ResponsiveDialogFooter>
          </form>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
