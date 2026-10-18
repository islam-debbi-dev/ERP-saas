'use client';

import { type ColumnDef, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { FolderTree, Loader2, PackageSearch, Plus, ScanBarcode } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { type BarcodeMatchDto, formatDA, type ProductDto, qty } from '@erp/shared';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable } from '@/components/table/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { api, ApiError } from '@/lib/api-client';
import {
  flattenCategories,
  useCategories,
  usePriceLevels,
  useProductPages,
  useUnitLabel,
} from '@/lib/catalog';
import { useErrorMessage } from '@/lib/use-error-message';

/** Scanners type a long run of digits then Enter. */
const looksLikeBarcode = (value: string) => /^[\w\-.]{6,}$/.test(value) && /\d{6,}/.test(value);

export function ProductsList() {
  const t = useTranslations('products');
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const unitLabel = useUnitLabel();
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [scanning, setScanning] = useState(false);
  const debounced = useDebouncedValue(search.trim(), 300);

  const pages = useProductPages(debounced, archived);
  const categories = useCategories();
  const levels = usePriceLevels();
  const items = useMemo(() => pages.data?.pages.flatMap((p) => p.items) ?? [], [pages.data]);

  const categoryName = useMemo(() => {
    const map = new Map(flattenCategories(categories.data ?? []).map((c) => [c.id, c.label]));
    return (id: string | null) => (id ? (map.get(id) ?? '') : '');
  }, [categories.data]);
  const firstLevelId = levels.data?.[0]?.id;

  const columns = useMemo<ColumnDef<ProductDto>[]>(
    () => [
      {
        id: 'reference',
        header: t('colReference'),
        cell: ({ row }) => (
          <span className="font-medium tabular-nums" dir="ltr">
            {row.original.reference}
          </span>
        ),
        size: 140,
      },
      {
        id: 'designation',
        header: t('colDesignation'),
        // A real link: keyboard and screen-reader users open the product without the row click.
        cell: ({ row }) => (
          <Link
            href={`/produits/${row.original.id}`}
            className="font-medium underline-offset-4 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {row.original.designation}
          </Link>
        ),
      },
      {
        id: 'category',
        header: t('colCategory'),
        cell: ({ row }) => (
          <span className="text-muted-foreground">{categoryName(row.original.categoryId)}</span>
        ),
      },
      {
        id: 'units',
        header: t('colUnits'),
        cell: ({ row }) => {
          const base = row.original.units.find((u) => u.unitId === row.original.baseUnitId);
          return (
            <div className="flex flex-wrap gap-1">
              {row.original.units.map((u) => (
                <Badge key={u.id} variant="secondary" className="font-normal">
                  {unitLabel({ code: u.unitCode, name: u.unitName })}
                  {u.unitId !== row.original.baseUnitId && base
                    ? ` ×${qty(u.factorToBase).toString()}`
                    : ''}
                </Badge>
              ))}
            </div>
          );
        },
      },
      {
        id: 'price',
        header: t('colPrice'),
        cell: ({ row }) => {
          const sale = row.original.units.find((u) => u.isDefaultSale);
          const price = row.original.prices.find(
            (p) => p.unitId === sale?.unitId && p.priceLevelId === firstLevelId,
          );
          return price ? (
            <span className="num whitespace-nowrap" dir="ltr">
              {formatDA(price.priceHt)}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
      },
      {
        id: 'status',
        header: t('colStatus'),
        cell: ({ row }) =>
          row.original.archivedAt ? (
            <Badge variant="outline">{t('statusArchived')}</Badge>
          ) : row.original.active ? (
            <Badge>{t('statusActive')}</Badge>
          ) : (
            <Badge variant="secondary">{t('statusInactive')}</Badge>
          ),
        size: 110,
      },
    ],
    [t, unitLabel, categoryName, firstLevelId],
  );

  const table = useReactTable({ data: items, columns, getCoreRowModel: getCoreRowModel() });

  /** Enter on a scanned barcode opens the product directly. */
  async function onEnter(value: string) {
    if (!looksLikeBarcode(value)) return;
    setScanning(true);
    try {
      const match = await api.request<BarcodeMatchDto>(
        `/products/by-barcode/${encodeURIComponent(value)}`,
      );
      router.push(`/produits/${match.product.id}`);
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.status === 404 ? t('barcodeNotFound') : errorMessage(err),
      );
    } finally {
      setScanning(false);
    }
  }

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/produits/categories">
                <FolderTree aria-hidden />
                {t('categories')}
              </Link>
            </Button>
            <Button asChild>
              <Link href="/produits/nouveau">
                <Plus aria-hidden />
                {t('new')}
              </Link>
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md">
          {scanning ? (
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
            type="search"
            autoFocus
            aria-label={t('searchLabel')}
            placeholder={t('searchPlaceholder')}
            className="ps-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void onEnter(search.trim());
              }
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="show-archived" checked={archived} onCheckedChange={setArchived} />
          <Label htmlFor="show-archived" className="font-normal">
            {t('showArchived')}
          </Label>
        </div>
      </div>

      <DataTable
        table={table}
        caption={t('title')}
        isLoading={pages.isPending}
        onRowClick={(p) => router.push(`/produits/${p.id}`)}
        emptyState={
          <EmptyState
            icon={PackageSearch}
            title={t('emptyTitle')}
            description={t('emptyDescription')}
          />
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
