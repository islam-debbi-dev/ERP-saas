'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ClipboardList, Loader2, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Feature, type InventoryDto, type InventoryStatus } from '@erp/shared';
import { EmptyState } from '@/components/shared/empty-state';
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
import { useFeature } from '@/lib/auth';
import { stockKeys, useInventories, useWarehouses } from '@/lib/stock';
import { WarehouseSelect } from './warehouse-select';
import { useErrorMessage } from '@/lib/use-error-message';

export function InventoryStatusBadge({ status }: { status: InventoryStatus }) {
  const t = useTranslations('inventory');
  const variant = status === 'OPEN' ? 'default' : status === 'VALIDATED' ? 'secondary' : 'outline';
  return <Badge variant={variant}>{t(`status${status}`)}</Badge>;
}

export function InventoriesList() {
  const t = useTranslations('inventory');
  const ts = useTranslations('stock');
  const format = useFormatter();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const inventories = useInventories();
  const [key] = useState(() => crypto.randomUUID());
  // Phase 15: with several dépôts, the count says which one it is.
  const warehousesOn = useFeature(Feature.WAREHOUSES);
  const warehouses = useWarehouses();
  const [picking, setPicking] = useState(false);
  const [warehouseId, setWarehouseId] = useState('');
  const nameOf = (id: string | null) => warehouses.data?.find((w) => w.id === id)?.name;

  const create = useMutation({
    mutationFn: () =>
      api.request<InventoryDto>('/inventories', {
        method: 'POST',
        body: warehouseId ? { warehouseId } : {},
        idempotencyKey: key,
      }),
    onSuccess: (inv) => {
      void queryClient.invalidateQueries({ queryKey: stockKeys.inventories });
      router.push(`/stock/inventaires/${inv.id}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const rows = inventories.data ?? [];
  return (
    <>
      <PageHeader
        title={t('listTitle')}
        description={t('listSubtitle')}
        actions={
          <>
            <Button asChild variant="ghost">
              <Link href="/stock">
                <ArrowLeft className="rtl-flip" aria-hidden />
                {ts('back')}
              </Link>
            </Button>
            <Button
              onClick={() => (warehousesOn ? setPicking(true) : create.mutate())}
              disabled={create.isPending}
            >
              {create.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Plus aria-hidden />
              )}
              {t('new')}
            </Button>
          </>
        }
      />
      <Card className="p-0">
        {inventories.isPending ? (
          <div className="space-y-2 p-4" aria-busy>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={t('emptyTitle')}
            description={t('emptyDescription')}
          />
        ) : (
          <ul className="divide-y">
            {rows.map((inv) => (
              <li key={inv.id}>
                <Link
                  href={`/stock/inventaires/${inv.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                >
                  <div className="min-w-0">
                    <p className="font-medium tabular-nums" dir="ltr">
                      {inv.number}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {format.dateTime(new Date(inv.createdAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}{' '}
                      · {t('lines')}: {inv.lineCount}
                      {warehousesOn && nameOf(inv.warehouseId)
                        ? ` · ${nameOf(inv.warehouseId)}`
                        : ''}
                    </p>
                  </div>
                  <InventoryStatusBadge status={inv.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ResponsiveDialog open={picking} onOpenChange={setPicking}>
        <ResponsiveDialogContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>{t('new')}</ResponsiveDialogTitle>
              <ResponsiveDialogDescription>{t('pickWarehouse')}</ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            <WarehouseSelect
              id="inventory-warehouse"
              value={warehouseId}
              onChange={setWarehouseId}
              defaultLabel={t('mainWarehouse')}
            />
            <ResponsiveDialogFooter>
              <Button type="button" variant="ghost" onClick={() => setPicking(false)}>
                {ts('cancel')}
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {t('new')}
              </Button>
            </ResponsiveDialogFooter>
          </form>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
