'use client';

import { type ColumnDef, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { Loader2, Plus, Ship } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Feature, type ImportFileStatus, type ImportFileSummaryDto } from '@erp/shared';
import { Amount } from '@/components/shared/amount';
import { EmptyState } from '@/components/shared/empty-state';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable } from '@/components/table/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useImportFilePages } from '@/lib/import-files';
import { ImportFileFormDialog } from './import-file-form-dialog';
import { ImportFileStatusBadge } from './import-file-status-badge';

/** Dossiers d'importation (phase 22, IMPORT_COSTS). */
export function ImportFilesList() {
  return (
    <FeatureGate feature={Feature.IMPORT_COSTS}>
      <List />
    </FeatureGate>
  );
}

function List() {
  const t = useTranslations('importFiles');
  const format = useFormatter();
  const router = useRouter();
  const [status, setStatus] = useState<ImportFileStatus | ''>('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const pages = useImportFilePages(status, useDebouncedValue(search.trim(), 300));
  const items = useMemo(() => pages.data?.pages.flatMap((p) => p.items) ?? [], [pages.data]);

  const columns = useMemo<ColumnDef<ImportFileSummaryDto>[]>(
    () => [
      {
        id: 'number',
        meta: { card: 'title' },
        header: t('colNumber'),
        cell: ({ row }) => (
          <Link
            href={`/achats/dossiers/${row.original.id}`}
            className="font-medium tabular-nums underline-offset-4 hover:underline"
            dir="ltr"
            onClick={(e) => e.stopPropagation()}
          >
            {row.original.number}
          </Link>
        ),
      },
      {
        id: 'reference',
        meta: { card: 'subtitle' },
        header: t('reference'),
        cell: ({ row }) => (
          <span dir="ltr" className="truncate">
            {[row.original.reference, row.original.containerNo].filter(Boolean).join(' / ') || '—'}
          </span>
        ),
      },
      {
        id: 'arrival',
        header: t('arrivalDate'),
        cell: ({ row }) =>
          row.original.arrivalDate
            ? format.dateTime(new Date(`${row.original.arrivalDate}T12:00:00Z`), {
                dateStyle: 'medium',
              })
            : '—',
      },
      {
        id: 'purchases',
        header: t('colPurchases'),
        cell: ({ row }) => <span className="num">{row.original.purchaseCount}</span>,
      },
      {
        id: 'landed',
        meta: { card: 'end' },
        header: t('colLanded'),
        cell: ({ row }) => (
          <span className="num whitespace-nowrap font-medium" dir="ltr">
            <Amount value={row.original.totalLanded} />
          </span>
        ),
      },
      {
        id: 'status',
        meta: { card: 'badge' },
        header: t('colStatus'),
        cell: ({ row }) => <ImportFileStatusBadge status={row.original.status} />,
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
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            {t('new')}
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="di-f-status">{t('colStatus')}</Label>
          <NativeSelect
            id="di-f-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as ImportFileStatus | '')}
          >
            <option value="">{t('allStatuses')}</option>
            <option value="OPEN">{t('statusOPEN')}</option>
            <option value="CLOSED">{t('statusCLOSED')}</option>
            <option value="CANCELLED">{t('statusCANCELLED')}</option>
          </NativeSelect>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="di-f-search">{t('search')}</Label>
          <Input
            id="di-f-search"
            type="search"
            dir="ltr"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      <DataTable
        table={table}
        caption={t('title')}
        isLoading={pages.isPending}
        onRowClick={(f) => router.push(`/achats/dossiers/${f.id}`)}
        emptyState={
          <EmptyState icon={Ship} title={t('emptyTitle')} description={t('emptyDescription')} />
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
      {creating ? (
        <ImportFileFormDialog
          open
          onOpenChange={setCreating}
          onSaved={(f) => router.push(`/achats/dossiers/${f.id}`)}
        />
      ) : null}
    </>
  );
}
