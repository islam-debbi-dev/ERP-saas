'use client';

import { type ColumnDef, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import {
  ArrowLeftRight,
  ClipboardList,
  Loader2,
  MoreHorizontal,
  PackageSearch,
  ScanBarcode,
  Warehouse,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Feature, formatDA, Permission, qty, type StockLevelDto } from '@erp/shared';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { Amount } from '@/components/shared/amount';
import { DataTable } from '@/components/table/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { formatQty, usePackagingLabel, useStockPages, useWarehouses } from '@/lib/stock';
import { useUnitLabel } from '@/lib/catalog';
import { useFeature, usePermission } from '@/lib/auth';
import { AdjustDialog, OpeningDialog } from './stock-dialogs';

type DialogState = { kind: 'adjust' | 'opening'; level: StockLevelDto } | null;

function StatusBadge({ level }: { level: StockLevelDto }) {
  const t = useTranslations('stock');
  if (qty(level.qtyBase).isNegative()) return <Badge variant="destructive">{t('negative')}</Badge>;
  if (level.lowStock)
    return (
      <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">
        {t('low')}
      </Badge>
    );
  return <Badge variant="secondary">{t('ok')}</Badge>;
}

export function StockLevels() {
  const t = useTranslations('stock');
  const router = useRouter();
  const unitLabel = useUnitLabel();
  const packagingLabel = usePackagingLabel();
  const [search, setSearch] = useState('');
  // The dashboard links here with ?filtre=bas or ?filtre=rupture.
  const filtre = useSearchParams().get('filtre');
  const [lowOnly, setLowOnly] = useState(filtre === 'bas');
  const [outOnly, setOutOnly] = useState(filtre === 'rupture');
  const [dialog, setDialog] = useState<DialogState>(null);
  // Phase 15: one dépôt, or the company with one column per dépôt.
  const warehousesOn = useFeature(Feature.WAREHOUSES);
  const warehouses = useWarehouses();
  const [warehouseId, setWarehouseId] = useState('');
  const debounced = useDebouncedValue(search.trim(), 300);
  const pages = useStockPages(debounced, lowOnly, outOnly, warehouseId);
  const depots = useMemo(
    () => (warehousesOn && !warehouseId ? (warehouses.data ?? []) : []),
    [warehousesOn, warehouseId, warehouses.data],
  );
  const items = useMemo(() => pages.data?.pages.flatMap((p) => p.items) ?? [], [pages.data]);
  const summary = pages.data?.pages[0]?.summary;

  const canAdjust = usePermission(Permission.STOCK_ADJUST);
  const columns = useMemo<ColumnDef<StockLevelDto>[]>(
    () => [
      {
        id: 'product',
        meta: { card: 'title' },
        header: t('colProduct'),
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              href={`/stock/${row.original.productId}`}
              className="font-medium underline-offset-4 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {row.original.designation}
            </Link>
            <p className="text-xs text-muted-foreground" dir="ltr">
              {row.original.reference}
            </p>
          </div>
        ),
      },
      {
        id: 'qty',
        meta: { card: 'end' },
        header: t('colQty'),
        cell: ({ row }) => (
          <div className="num whitespace-nowrap">
            <p className="font-medium">{packagingLabel(row.original)}</p>
            {row.original.packaging ? (
              <p className="text-xs text-muted-foreground">
                {formatQty(row.original.qtyBase)}{' '}
                {unitLabel({
                  code: row.original.baseUnit.unitCode,
                  name: row.original.baseUnit.unitName,
                })}
              </p>
            ) : null}
            {depots.length > 1 ? (
              // Phone card: the split per dépôt under the total (columns on a computer).
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground md:hidden">
                {(row.original.byWarehouse ?? [])
                  .filter((w) => !qty(w.qtyBase).isZero())
                  .map((w) => (
                    <li key={w.warehouseId} className="flex justify-end gap-2">
                      <span className="truncate">
                        {depots.find((d) => d.id === w.warehouseId)?.name}
                      </span>
                      <bdi dir="ltr">{formatQty(w.qtyBase)}</bdi>
                    </li>
                  ))}
              </ul>
            ) : null}
          </div>
        ),
      },
      ...(depots.length > 1
        ? depots.map<ColumnDef<StockLevelDto>>((d) => ({
            id: `wh-${d.id}`,
            meta: { card: 'hidden' },
            header: d.name,
            cell: ({ row }) => {
              const q = row.original.byWarehouse?.find((w) => w.warehouseId === d.id)?.qtyBase;
              return (
                <span
                  className={`num whitespace-nowrap ${q && qty(q).isNegative() ? 'text-destructive' : ''}`}
                  dir="ltr"
                >
                  {q ? formatQty(q) : '—'}
                </span>
              );
            },
          }))
        : []),
      {
        id: 'cump',
        header: t('colCump'),
        cell: ({ row }) => (
          <span className="num whitespace-nowrap" dir="ltr">
            {row.original.avgCost === null ? '—' : <Amount value={row.original.avgCost} />}
          </span>
        ),
      },
      {
        id: 'value',
        header: t('colValue'),
        cell: ({ row }) => (
          <span className="num whitespace-nowrap font-medium" dir="ltr">
            {row.original.value === null ? '—' : <Amount value={row.original.value} />}
          </span>
        ),
      },
      {
        id: 'status',
        meta: { card: 'badge' },
        header: t('colStatus'),
        cell: ({ row }) => <StatusBadge level={row.original} />,
        size: 110,
      },
      {
        id: 'actions',
        meta: { card: 'actions' },
        header: () => <span className="sr-only">{t('colActions')}</span>,
        size: 56,
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('actions', { product: row.original.designation })}
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem asChild>
                <Link href={`/stock/${row.original.productId}`}>{t('card')}</Link>
              </DropdownMenuItem>
              {canAdjust ? (
                <DropdownMenuItem
                  onSelect={() => setDialog({ kind: 'adjust', level: row.original })}
                >
                  {t('adjust')}
                </DropdownMenuItem>
              ) : null}
              {!row.original.hasOpening ? (
                <DropdownMenuItem
                  onSelect={() => setDialog({ kind: 'opening', level: row.original })}
                >
                  {t('opening')}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [t, packagingLabel, unitLabel, canAdjust, depots],
  );

  const table = useReactTable({ data: items, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button asChild variant="outline">
            <Link href="/stock/inventaires">
              <ClipboardList aria-hidden />
              {t('inventories')}
            </Link>
          </Button>
        }
        more={
          warehousesOn
            ? [
                { label: t('transfers'), icon: ArrowLeftRight, href: '/stock/transferts' },
                { label: t('warehouses'), icon: Warehouse, href: '/stock/depots' },
              ]
            : undefined
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        {[
          {
            label: t('summaryValue'),
            value: summary
              ? summary.totalValue === null
                ? '—'
                : formatDA(summary.totalValue)
              : null,
          },
          {
            label: t('summaryLow'),
            value: summary ? formatQty(String(summary.lowStockCount)) : null,
          },
          {
            label: t('summaryProducts'),
            value: summary ? formatQty(String(summary.productCount)) : null,
          },
        ].map((card) => (
          // First card (value / quantity) spans the row on phones, the other two share one.
          <Card key={card.label} className="py-4 first:col-span-2 sm:first:col-span-1">
            <CardContent className="space-y-1">
              <p className="text-sm text-muted-foreground">{card.label}</p>
              {card.value === null ? (
                <Skeleton className="h-7 w-28" />
              ) : (
                <p className="num text-xl font-semibold" dir="ltr">
                  {card.value}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md">
          <ScanBarcode
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            autoFocus
            aria-label={t('searchLabel')}
            placeholder={t('searchPlaceholder')}
            className="ps-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {warehousesOn ? (
            <NativeSelect
              aria-label={t('warehouseFilter')}
              className="w-full sm:w-56"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
            >
              <option value="">{t('allWarehouses')}</option>
              {(warehouses.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </NativeSelect>
          ) : null}
          <div className="flex items-center gap-2">
            <Switch id="low-only" checked={lowOnly} onCheckedChange={setLowOnly} />
            <Label htmlFor="low-only" className="font-normal">
              {t('lowStockOnly')}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="out-only" checked={outOnly} onCheckedChange={setOutOnly} />
            <Label htmlFor="out-only" className="font-normal">
              {t('outOfStockOnly')}
            </Label>
          </div>
        </div>
      </div>

      <DataTable
        table={table}
        caption={t('title')}
        isLoading={pages.isPending}
        onRowClick={(l) => router.push(`/stock/${l.productId}`)}
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

      {dialog ? (
        dialog.kind === 'adjust' ? (
          <AdjustDialog
            productId={dialog.level.productId}
            productName={dialog.level.designation}
            open
            onOpenChange={(open) => !open && setDialog(null)}
          />
        ) : (
          <OpeningDialog
            productId={dialog.level.productId}
            productName={dialog.level.designation}
            open
            onOpenChange={(open) => !open && setDialog(null)}
          />
        )
      ) : null}
    </>
  );
}
