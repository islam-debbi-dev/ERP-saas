'use client';

import { type ColumnDef, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { Loader2, Plus, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { type ClientDto, formatDA } from '@erp/shared';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable } from '@/components/table/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useClientPages } from '@/lib/clients';
import { BalanceAmount } from './balance-amount';

export function ClientsList() {
  const t = useTranslations('clients');
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [hasDebt, setHasDebt] = useState(false);
  const [overLimit, setOverLimit] = useState(false);
  const debounced = useDebouncedValue(search.trim(), 300);
  const pages = useClientPages({ search: debounced, hasDebt, overLimit });
  const items = useMemo(() => pages.data?.pages.flatMap((p) => p.items) ?? [], [pages.data]);
  const filtered = debounced !== '' || hasDebt || overLimit;

  const columns = useMemo<ColumnDef<ClientDto>[]>(
    () => [
      {
        id: 'code',
        header: t('code'),
        cell: ({ row }) => (
          <span dir="ltr" className="num text-muted-foreground">
            {row.original.code}
          </span>
        ),
      },
      {
        id: 'name',
        header: t('name'),
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              href={`/clients/${row.original.id}`}
              className="font-medium underline-offset-4 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {row.original.name}
            </Link>
            {row.original.wilaya || row.original.commune ? (
              <p className="text-xs text-muted-foreground">
                {[row.original.commune, row.original.wilaya].filter(Boolean).join(', ')}
              </p>
            ) : null}
          </div>
        ),
      },
      {
        id: 'phone',
        header: t('phone'),
        cell: ({ row }) =>
          row.original.phone ? (
            <span dir="ltr" className="num whitespace-nowrap">
              {row.original.phone}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: 'balance',
        header: t('balance'),
        cell: ({ row }) => <BalanceAmount value={row.original.balance} />,
      },
      {
        id: 'plafond',
        header: t('creditLimit'),
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-2">
            {row.original.creditLimit === null ? (
              <span className="text-muted-foreground">{t('noLimit')}</span>
            ) : (
              <span dir="ltr" className="num whitespace-nowrap">
                {formatDA(row.original.creditLimit)}
              </span>
            )}
            {row.original.overLimit ? <Badge variant="destructive">{t('overLimit')}</Badge> : null}
          </div>
        ),
      },
    ],
    [t],
  );
  const table = useReactTable({ data: items, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button asChild>
            <Link href="/clients/nouveau">
              <Plus aria-hidden />
              {t('new')}
            </Link>
          </Button>
        }
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
        <Input
          type="search"
          aria-label={t('searchLabel')}
          placeholder={t('searchLabel')}
          className="sm:max-w-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <Switch id="f-debt" checked={hasDebt} onCheckedChange={setHasDebt} />
          <Label htmlFor="f-debt">{t('filterDebt')}</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="f-over" checked={overLimit} onCheckedChange={setOverLimit} />
          <Label htmlFor="f-over">{t('filterOverLimit')}</Label>
        </div>
      </div>
      <DataTable
        table={table}
        caption={t('title')}
        isLoading={pages.isPending}
        onRowClick={(c) => router.push(`/clients/${c.id}`)}
        emptyState={
          filtered ? (
            <EmptyState icon={Users} title={t('noMatch')} />
          ) : (
            <EmptyState icon={Users} title={t('emptyTitle')} description={t('emptyDescription')} />
          )
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
