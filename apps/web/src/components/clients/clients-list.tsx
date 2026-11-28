'use client';

import { type ColumnDef, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { BellRing, Loader2, Map as MapIcon, MapPinned, Plus, UserCheck, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { clientListQuerySchema, type ClientDto, Feature, Role } from '@erp/shared';
import { EmptyState } from '@/components/shared/empty-state';
import { type FilterChip, FilterChips } from '@/components/shared/filter-chips';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable } from '@/components/table/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { BulkAssignDialog } from '@/components/sales-force/bulk-assign-dialog';
import { StickyActions } from '@/components/shared/sticky-actions';
import { useAuth, useFeature } from '@/lib/auth';
import { useSectors, useSellers } from '@/lib/sales-force';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useCanManageCredit, useClientPages } from '@/lib/clients';
import { type CommunesModule, communeDisplay, wilayaDisplay } from '@/lib/locations';
import { useCommunes } from '@/lib/use-communes';
import { useUrlFilters } from '@/lib/url-filters';
import { BalanceAmount } from './balance-amount';
import { Amount } from '@/components/shared/amount';

const on = z.literal('1');
/** URL names of the dashboard links (phase 33), mapped to the API's filters. */
const CLIENT_URL_FILTERS = {
  hasBalance: on,
  overLimit: on,
  sort: z.literal('balance_desc'),
  sectorId: clientListQuerySchema.shape.sectorId,
  sellerId: clientListQuerySchema.shape.assignedSellerId,
  /** Phase 35: the map's "N clients sans position" link. */
  hasLocation: z.enum(['true', 'false']),
};

export function ClientsList() {
  const t = useTranslations('clients');
  const tr = useTranslations('reminders');
  const router = useRouter();
  const canManage = useCanManageCredit();
  const td = useTranslations('dashboard');
  const [search, setSearch] = useState('');
  // Phase 33: the filters (not the typed search) live in the URL; the dashboard links here.
  const [url, set] = useUrlFilters(CLIENT_URL_FILTERS);
  const hasDebt = url.hasBalance === '1';
  const overLimit = url.overLimit === '1';
  const { sectorId, sellerId } = url;
  const flag = (key: 'hasBalance' | 'overLimit') => (on: boolean) => set({ [key]: on ? '1' : '' });
  const debounced = useDebouncedValue(search.trim(), 300);
  const pages = useClientPages({
    search: debounced,
    hasDebt,
    overLimit,
    sectorId,
    assignedSellerId: sellerId,
    ...(url.hasLocation ? { hasLocation: url.hasLocation === 'true' } : {}),
    ...(url.sort === 'balance_desc' ? { sort: 'balance_desc' as const } : {}),
  });
  const items = useMemo(() => pages.data?.pages.flatMap((p) => p.items) ?? [], [pages.data]);
  const filtered =
    debounced !== '' ||
    hasDebt ||
    overLimit ||
    sectorId !== '' ||
    sellerId !== '' ||
    url.hasLocation !== '';
  const geo = useFeature(Feature.GEO_CHECK);

  // Sales force (phase 14): sector / seller columns and filters; managers assign in bulk.
  const salesForce = useFeature(Feature.SALES_FORCE);
  const { state } = useAuth();
  const role = state.user?.role;
  const canAssign = salesForce && (role === Role.OWNER || role === Role.MANAGER);
  const canFilterSeller = salesForce && role !== Role.SELLER;
  const sectors = useSectors();
  const sellers = useSellers();
  const chips: FilterChip[] = [];
  const chip = (key: keyof typeof url, label: string) =>
    chips.push({ key, label, onRemove: () => set({ [key]: '' }) });
  if (url.sort) chip('sort', td('chipSortBalance'));
  if (hasDebt) chip('hasBalance', t('filterDebt'));
  if (overLimit) chip('overLimit', t('filterOverLimit'));
  if (url.hasLocation)
    chip('hasLocation', url.hasLocation === 'true' ? t('withLocation') : t('withoutLocation'));
  if (sectorId)
    chip('sectorId', sectors.data?.find((x) => x.id === sectorId)?.name ?? t('filterSector'));
  if (sellerId)
    chip(
      'sellerId',
      td('chipSeller', { name: sellers.data?.find((u) => u.id === sellerId)?.fullName ?? '…' }),
    );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState(false);
  const toggle = (id: string, on: boolean) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const locale = useLocale();
  // The commune data is only fetched when a listed client has a commune code.
  const communes = useCommunes(items.some((c) => c.communeCode !== null));
  const columns = useMemo<ColumnDef<ClientDto>[]>(
    () => [
      ...(canAssign
        ? [
            {
              id: 'select',
              meta: { card: 'leading' },
              header: () => <span className="sr-only">{t('selectForAssign')}</span>,
              cell: ({ row }) => (
                <input
                  type="checkbox"
                  className="size-6 accent-primary md:size-4"
                  aria-label={t('selectClient', { name: row.original.name })}
                  checked={selected.has(row.original.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => toggle(row.original.id, e.target.checked)}
                />
              ),
            } satisfies ColumnDef<ClientDto>,
          ]
        : []),
      {
        id: 'code',
        header: t('code'),
        meta: { card: 'subtitle' },
        cell: ({ row }) => (
          <span dir="ltr" className="num text-muted-foreground">
            {row.original.code}
          </span>
        ),
      },
      {
        id: 'name',
        header: t('name'),
        meta: { card: 'title' },
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              href={`/clients/${row.original.id}`}
              // A Latin name inside Arabic: truncate at its own end, not its start.
              dir="auto"
              className="font-medium underline-offset-4 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {row.original.name}
            </Link>
            <PlaceLine client={row.original} data={communes.data} locale={locale} />
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
        meta: { card: 'end' },
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
              <Amount value={row.original.creditLimit} />
            )}
            {row.original.overLimit ? <Badge variant="destructive">{t('overLimit')}</Badge> : null}
          </div>
        ),
      },
      ...(salesForce
        ? [
            {
              id: 'assignment',
              header: t('sectorSeller'),
              cell: ({ row }) =>
                row.original.sector || row.original.assignedSeller ? (
                  <div className="min-w-0 text-sm">
                    {row.original.sector ? (
                      <p className="truncate">{row.original.sector.name}</p>
                    ) : null}
                    {row.original.assignedSeller ? (
                      <p className="truncate text-muted-foreground">
                        {row.original.assignedSeller.fullName}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                ),
            } satisfies ColumnDef<ClientDto>,
          ]
        : []),
    ],
    [t, canAssign, salesForce, selected, communes.data, locale],
  );
  const table = useReactTable({ data: items, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        more={[
          canManage && { label: tr('title'), icon: BellRing, href: '/clients/a-relancer' },
          salesForce && { label: t('sectors'), icon: MapPinned, href: '/clients/secteurs' },
        ]}
        actions={
          <>
            {geo ? (
              <Button asChild variant="outline">
                <Link href="/clients/carte">
                  <MapIcon aria-hidden />
                  {t('map')}
                </Link>
              </Button>
            ) : null}
            <Button asChild>
              <Link href="/clients/nouveau">
                <Plus aria-hidden />
                {t('new')}
              </Link>
            </Button>
          </>
        }
      />
      <FilterChips
        chips={chips}
        onClear={() =>
          set({
            sort: '',
            hasBalance: '',
            overLimit: '',
            sectorId: '',
            sellerId: '',
            hasLocation: '',
          })
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
          <Switch id="f-debt" checked={hasDebt} onCheckedChange={flag('hasBalance')} />
          <Label htmlFor="f-debt">{t('filterDebt')}</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="f-over" checked={overLimit} onCheckedChange={flag('overLimit')} />
          <Label htmlFor="f-over">{t('filterOverLimit')}</Label>
        </div>
        {geo ? (
          <div className="flex items-center gap-2">
            <Label htmlFor="f-location" className="shrink-0">
              {t('filterLocation')}
            </Label>
            <NativeSelect
              id="f-location"
              value={url.hasLocation}
              onChange={(e) => set({ hasLocation: e.target.value })}
            >
              <option value="">{t('anyLocation')}</option>
              <option value="true">{t('withLocation')}</option>
              <option value="false">{t('withoutLocation')}</option>
            </NativeSelect>
          </div>
        ) : null}
      </div>
      {salesForce ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
          <div className="space-y-1">
            <Label htmlFor="f-sector">{t('filterSector')}</Label>
            <NativeSelect
              id="f-sector"
              value={sectorId}
              onChange={(e) => set({ sectorId: e.target.value })}
            >
              <option value="">{t('allSectors')}</option>
              {(sectors.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          {canFilterSeller ? (
            <div className="space-y-1">
              <Label htmlFor="f-seller">{t('filterSeller')}</Label>
              <NativeSelect
                id="f-seller"
                value={sellerId}
                onChange={(e) => set({ sellerId: e.target.value })}
              >
                <option value="">{t('allSellers')}</option>
                {(sellers.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
        </div>
      ) : null}
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
      {canAssign && selected.size > 0 ? (
        <StickyActions className="md:sticky md:bottom-4 md:rounded-lg md:border md:bg-background md:p-3 md:shadow-sm">
          <p role="status" className="me-auto text-sm font-medium max-md:basis-full">
            {t('selectedCount', { count: selected.size })}
          </p>
          <Button type="button" variant="ghost" onClick={() => setSelected(new Set())}>
            {t('clearSelection')}
          </Button>
          <Button type="button" onClick={() => setAssigning(true)}>
            <UserCheck aria-hidden />
            {t('assign')}
          </Button>
        </StickyActions>
      ) : null}
      {assigning ? (
        <BulkAssignDialog
          clientIds={[...selected]}
          open
          onOpenChange={setAssigning}
          onDone={() => setSelected(new Set())}
        />
      ) : null}
    </>
  );
}

/** "Commune, wilaya": the names of the codes in the screen's language, else the stored text. */
function PlaceLine({
  client,
  data,
  locale,
}: {
  client: ClientDto;
  data: CommunesModule | undefined;
  locale: string;
}) {
  const text = [
    communeDisplay(data, client.communeCode, client.commune, locale),
    wilayaDisplay(client.wilayaCode, client.wilaya, locale),
  ]
    .filter(Boolean)
    .join(locale === 'ar' ? '، ' : ', ');
  return text ? (
    <p dir="auto" className="truncate text-xs text-muted-foreground" title={text}>
      {text}
    </p>
  ) : null;
}
