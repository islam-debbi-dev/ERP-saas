'use client';

import { type ColumnDef, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { Loader2, Plus, Receipt, Truck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { type PurchaseSummaryDto } from '@erp/shared';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable } from '@/components/table/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { type PurchaseFilters, usePurchasePages, useSuppliers } from '@/lib/purchases';
import { PurchaseStatusBadge } from './purchase-status-badge';
import { Amount } from '@/components/shared/amount';

export function PurchasesList() {
  const t = useTranslations('purchases');
  const format = useFormatter();
  const router = useRouter();
  const [filters, setFilters] = useState<PurchaseFilters>({
    status: '',
    supplierId: '',
    from: '',
    to: '',
  });
  const pages = usePurchasePages(filters);
  const suppliers = useSuppliers();
  const items = useMemo(() => pages.data?.pages.flatMap((p) => p.items) ?? [], [pages.data]);
  const set = (patch: Partial<PurchaseFilters>) => setFilters((f) => ({ ...f, ...patch }));

  const columns = useMemo<ColumnDef<PurchaseSummaryDto>[]>(
    () => [
      {
        id: 'number',
        header: t('colNumber'),
        cell: ({ row }) => (
          <Link
            href={`/achats/${row.original.id}`}
            className="font-medium tabular-nums underline-offset-4 hover:underline"
            dir="ltr"
            onClick={(e) => e.stopPropagation()}
          >
            {row.original.number ?? t('draftNumber')}
          </Link>
        ),
      },
      {
        id: 'date',
        header: t('colDate'),
        cell: ({ row }) =>
          format.dateTime(new Date(`${row.original.documentDate}T12:00:00Z`), {
            dateStyle: 'medium',
          }),
      },
      { id: 'supplier', header: t('colSupplier'), cell: ({ row }) => row.original.supplier.name },
      {
        id: 'lines',
        header: t('colLines'),
        cell: ({ row }) => <span className="num">{row.original.lineCount}</span>,
      },
      {
        id: 'total',
        header: t('colTotal'),
        cell: ({ row }) => (
          <span className="num whitespace-nowrap font-medium" dir="ltr">
            <Amount value={row.original.totalTtc} />
          </span>
        ),
      },
      {
        id: 'status',
        header: t('colStatus'),
        cell: ({ row }) => <PurchaseStatusBadge status={row.original.status} />,
      },
    ],
    [t, format],
  );
  const table = useReactTable({ data: items, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/achats/fournisseurs">
                <Truck aria-hidden />
                {t('suppliers')}
              </Link>
            </Button>
            <Button asChild>
              <Link href="/achats/nouveau">
                <Plus aria-hidden />
                {t('new')}
              </Link>
            </Button>
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="f-status">{t('colStatus')}</Label>
          <NativeSelect
            id="f-status"
            value={filters.status}
            onChange={(e) => set({ status: e.target.value as PurchaseFilters['status'] })}
          >
            <option value="">{t('allStatuses')}</option>
            <option value="DRAFT">{t('statusDRAFT')}</option>
            <option value="VALIDATED">{t('statusVALIDATED')}</option>
            <option value="CANCELLED">{t('statusCANCELLED')}</option>
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="f-supplier">{t('colSupplier')}</Label>
          <NativeSelect
            id="f-supplier"
            value={filters.supplierId}
            onChange={(e) => set({ supplierId: e.target.value })}
          >
            <option value="">{t('allSuppliers')}</option>
            {(suppliers.data?.items ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="f-from">{t('from')}</Label>
          <Input
            id="f-from"
            type="date"
            dir="ltr"
            value={filters.from}
            onChange={(e) => set({ from: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="f-to">{t('to')}</Label>
          <Input
            id="f-to"
            type="date"
            dir="ltr"
            value={filters.to}
            onChange={(e) => set({ to: e.target.value })}
          />
        </div>
      </div>
      <DataTable
        table={table}
        caption={t('title')}
        isLoading={pages.isPending}
        onRowClick={(p) => router.push(`/achats/${p.id}`)}
        emptyState={
          <EmptyState icon={Receipt} title={t('emptyTitle')} description={t('emptyDescription')} />
        }
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
    </>
  );
}
