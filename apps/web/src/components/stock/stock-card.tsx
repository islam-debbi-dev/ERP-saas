'use client';

import { type ColumnDef, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { ArrowLeft, History, Loader2, PackagePlus, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { formatDA, qty, type StockMovementDto } from '@erp/shared';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable } from '@/components/table/data-table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatQty, useMovementPages, usePackagingLabel, useStockLevel } from '@/lib/stock';
import { useErrorMessage } from '@/lib/use-error-message';
import { cn } from '@/lib/utils';
import { AdjustDialog, OpeningDialog } from './stock-dialogs';

export function StockCard({ productId }: { productId: string }) {
  const t = useTranslations('stock');
  const tt = useTranslations('movementTypes');
  const tr = useTranslations('adjustmentReasons');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const packagingLabel = usePackagingLabel();
  const level = useStockLevel(productId);
  const pages = useMovementPages(productId);
  const [dialog, setDialog] = useState<'adjust' | 'opening' | null>(null);
  const items = useMemo(() => pages.data?.pages.flatMap((p) => p.items) ?? [], [pages.data]);

  const columns = useMemo<ColumnDef<StockMovementDto>[]>(
    () => [
      {
        id: 'date',
        header: t('colDate'),
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            {format.dateTime(new Date(row.original.createdAt), {
              dateStyle: 'short',
              timeStyle: 'short',
            })}
          </span>
        ),
      },
      {
        id: 'type',
        header: t('colType'),
        cell: ({ row }) => (
          <div className="space-y-1">
            <Badge variant="secondary" className="font-normal">
              {tt(row.original.type)}
            </Badge>
            {row.original.reason ? (
              <p className="text-xs text-muted-foreground">{tr(row.original.reason)}</p>
            ) : null}
          </div>
        ),
      },
      {
        id: 'move',
        header: t('colMove'),
        cell: ({ row }) => {
          const positive = qty(row.original.qtyBase).gt(0);
          return (
            <span
              dir="ltr"
              className={cn('num font-medium', positive ? 'text-primary' : 'text-destructive')}
            >
              {formatQty(row.original.qtyBase, { signed: true })}
            </span>
          );
        },
      },
      {
        id: 'balance',
        header: t('colBalance'),
        cell: ({ row }) => (
          <span dir="ltr" className="num">
            {formatQty(row.original.balanceAfter)}
          </span>
        ),
      },
      {
        id: 'cost',
        header: t('colCost'),
        cell: ({ row }) =>
          row.original.unitCost ? (
            <span dir="ltr" className="num whitespace-nowrap">
              {formatDA(row.original.unitCost)}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: 'by',
        header: t('colBy'),
        cell: ({ row }) => (
          <div className="min-w-0">
            <p>{row.original.createdBy?.fullName ?? '—'}</p>
            {row.original.note ? (
              <p className="text-xs text-muted-foreground">{row.original.note}</p>
            ) : null}
          </div>
        ),
      },
    ],
    [t, tt, tr, format],
  );
  const table = useReactTable({ data: items, columns, getCoreRowModel: getCoreRowModel() });

  if (level.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{errorMessage(level.error)}</AlertDescription>
      </Alert>
    );
  }
  const l = level.data;

  return (
    <>
      <PageHeader
        title={l ? `${t('cardTitle')} — ${l.designation}` : t('cardTitle')}
        description={t('cardSubtitle')}
        actions={
          <>
            <Button asChild variant="ghost">
              <Link href="/stock">
                <ArrowLeft className="rtl-flip" aria-hidden />
                {t('back')}
              </Link>
            </Button>
            {l && !l.hasOpening ? (
              <Button variant="outline" onClick={() => setDialog('opening')}>
                <PackagePlus aria-hidden />
                {t('opening')}
              </Button>
            ) : null}
            <Button onClick={() => setDialog('adjust')} disabled={!l}>
              <SlidersHorizontal aria-hidden />
              {t('adjust')}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        {[
          { label: t('currentQty'), value: l ? packagingLabel(l) : null, ltr: false },
          // Amounts are LTR so "DA" stays after the number in Arabic.
          { label: t('currentCump'), value: l ? formatDA(l.avgCost) : null, ltr: true },
          { label: t('currentValue'), value: l ? formatDA(l.value) : null, ltr: true },
        ].map((card) => (
          // First card (value / quantity) spans the row on phones, the other two share one.
          <Card key={card.label} className="py-4 first:col-span-2 sm:first:col-span-1">
            <CardContent className="space-y-1">
              <p className="text-sm text-muted-foreground">{card.label}</p>
              {card.value === null ? (
                <Skeleton className="h-7 w-28" />
              ) : (
                <p className="num text-xl font-semibold" dir={card.ltr ? 'ltr' : undefined}>
                  {card.value}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <DataTable
        table={table}
        caption={t('cardTitle')}
        isLoading={pages.isPending}
        emptyState={<EmptyState icon={History} title={t('noMovements')} />}
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

      {l && dialog === 'adjust' ? (
        <AdjustDialog
          productId={productId}
          productName={l.designation}
          open
          onOpenChange={(o) => !o && setDialog(null)}
        />
      ) : null}
      {l && dialog === 'opening' ? (
        <OpeningDialog
          productId={productId}
          productName={l.designation}
          open
          onOpenChange={(o) => !o && setDialog(null)}
        />
      ) : null}
    </>
  );
}
