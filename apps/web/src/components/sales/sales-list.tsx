'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { FileText, Loader2, Plus, ReceiptText } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { type SaleResultDto, type SaleSummaryDto } from '@erp/shared';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable } from '@/components/table/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { api } from '@/lib/api-client';
import { useClientPages } from '@/lib/clients';
import { todayInAlgiers } from '@/lib/purchases';
import { type SaleFilters, saleKeys, useSalePages } from '@/lib/sales';
import { useErrorMessage } from '@/lib/use-error-message';
import { SaleStatusBadge } from './sale-status-badge';
import { Amount } from '@/components/shared/amount';

/** Only validated BLs of a known client, not yet grouped, can go in a facture. */
const invoiceable = (s: SaleSummaryDto) =>
  s.type === 'BL' && s.status === 'VALIDATED' && !s.invoice && s.client !== null;

export function SalesList() {
  const t = useTranslations('sales');
  const format = useFormatter();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<SaleFilters>({
    type: '',
    status: '',
    clientId: '',
    from: '',
    to: '',
  });
  const [selected, setSelected] = useState<Map<string, SaleSummaryDto>>(new Map());
  const pages = useSalePages(filters);
  const clients = useClientPages({ search: '', hasDebt: false, overLimit: false });
  const items = useMemo(() => pages.data?.pages.flatMap((p) => p.items) ?? [], [pages.data]);
  const set = (patch: Partial<SaleFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const picked = [...selected.values()];
  const sameClient = new Set(picked.map((s) => s.client?.id)).size === 1;

  const invoice = useMutation({
    mutationFn: () =>
      api.request<SaleResultDto>('/invoices/from-bls', {
        method: 'POST',
        body: { saleIds: picked.map((s) => s.id), documentDate: todayInAlgiers() },
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: saleKeys.all });
      toast.success(t('invoiced', { number: r.sale.number ?? '' }));
      router.push(`/ventes/${r.sale.id}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const columns = useMemo<ColumnDef<SaleSummaryDto>[]>(
    () => [
      {
        id: 'select',
        meta: { card: 'leading' },
        header: () => <span className="sr-only">{t('selectForInvoice')}</span>,
        cell: ({ row }) =>
          invoiceable(row.original) ? (
            <input
              type="checkbox"
              className="size-4 accent-primary"
              aria-label={t('selectBl', { number: row.original.number ?? '' })}
              checked={selected.has(row.original.id)}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) =>
                setSelected((m) => {
                  const next = new Map(m);
                  if (e.target.checked) next.set(row.original.id, row.original);
                  else next.delete(row.original.id);
                  return next;
                })
              }
            />
          ) : null,
      },
      {
        id: 'number',
        meta: { card: 'title' },
        header: t('colNumber'),
        cell: ({ row }) => (
          <div className="space-y-1">
            <Link
              href={`/ventes/${row.original.id}`}
              className="font-medium tabular-nums underline-offset-4 hover:underline"
              dir="ltr"
              onClick={(e) => e.stopPropagation()}
            >
              {row.original.number ?? t('draft')}
            </Link>
            {row.original.invoice ? (
              <p className="text-xs text-muted-foreground">
                {t('invoicedIn')} <span dir="ltr">{row.original.invoice.number}</span>
              </p>
            ) : null}
          </div>
        ),
      },
      {
        id: 'type',
        header: t('colType'),
        cell: ({ row }) => (
          <Badge variant="outline" className="font-normal">
            {t(`type${row.original.type}`)}
          </Badge>
        ),
      },
      {
        id: 'date',
        header: t('date'),
        cell: ({ row }) =>
          format.dateTime(new Date(`${row.original.documentDate}T12:00:00Z`), {
            dateStyle: 'medium',
          }),
      },
      {
        id: 'client',
        meta: { card: 'subtitle' },
        header: t('client'),
        cell: ({ row }) =>
          row.original.client?.name ?? (
            <span className="text-muted-foreground">{t('counterClient')}</span>
          ),
      },
      {
        id: 'total',
        meta: { card: 'end' },
        header: t('totalTtc'),
        cell: ({ row }) => (
          <span className="num whitespace-nowrap font-medium" dir="ltr">
            <Amount value={row.original.totalTtc} />
          </span>
        ),
      },
      {
        id: 'paid',
        header: t('paid'),
        cell: ({ row }) => (
          <span className="num whitespace-nowrap" dir="ltr">
            <Amount value={row.original.paidAmount} />
          </span>
        ),
      },
      {
        id: 'status',
        meta: { card: 'badge' },
        header: t('status'),
        cell: ({ row }) => <SaleStatusBadge status={row.original.status} />,
      },
    ],
    [t, format, selected],
  );
  const table = useReactTable({ data: items, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <>
            {picked.length > 0 ? (
              <Button
                variant="outline"
                disabled={!sameClient || invoice.isPending}
                onClick={() => invoice.mutate()}
              >
                {invoice.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <FileText aria-hidden />
                )}
                {t('invoiceSelection', { count: picked.length })}
              </Button>
            ) : null}
            <Button asChild>
              <Link href="/ventes/nouvelle">
                <Plus aria-hidden />
                {t('new')}
              </Link>
            </Button>
          </>
        }
      />
      {picked.length > 0 && !sameClient ? (
        <p role="status" className="text-sm text-destructive">
          {t('sameClientOnly')}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-5">
        <div className="space-y-1">
          <Label htmlFor="f-type">{t('colType')}</Label>
          <NativeSelect
            id="f-type"
            value={filters.type}
            onChange={(e) => set({ type: e.target.value as SaleFilters['type'] })}
          >
            <option value="">{t('allTypes')}</option>
            <option value="BL">{t('typeBL')}</option>
            <option value="FACTURE">{t('typeFACTURE')}</option>
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="f-status">{t('status')}</Label>
          <NativeSelect
            id="f-status"
            value={filters.status}
            onChange={(e) => set({ status: e.target.value as SaleFilters['status'] })}
          >
            <option value="">{t('allStatuses')}</option>
            <option value="DRAFT">{t('statusDRAFT')}</option>
            <option value="VALIDATED">{t('statusVALIDATED')}</option>
            <option value="CANCELLED">{t('statusCANCELLED')}</option>
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="f-client">{t('client')}</Label>
          <NativeSelect
            id="f-client"
            value={filters.clientId}
            onChange={(e) => set({ clientId: e.target.value })}
          >
            <option value="">{t('allClients')}</option>
            {(clients.data?.pages[0]?.items ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
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
        onRowClick={(s) => router.push(`/ventes/${s.id}`)}
        emptyState={
          <EmptyState
            icon={ReceiptText}
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
