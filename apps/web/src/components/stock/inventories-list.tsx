'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ClipboardList, Loader2, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import type { InventoryDto, InventoryStatus } from '@erp/shared';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { stockKeys, useInventories } from '@/lib/stock';
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

  const create = useMutation({
    mutationFn: () =>
      api.request<InventoryDto>('/inventories', { method: 'POST', body: {}, idempotencyKey: key }),
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
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
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
                    </p>
                  </div>
                  <InventoryStatusBadge status={inv.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
