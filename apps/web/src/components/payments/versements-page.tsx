'use client';

import { type ColumnDef, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { Banknote, Loader2, Plus } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { type PaymentDto } from '@erp/shared';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable } from '@/components/table/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { useClientPages } from '@/lib/clients';
import { type PaymentFilters, useCashSummary, usePaymentPages } from '@/lib/payments';
import { todayInAlgiers } from '@/lib/purchases';
import { cn } from '@/lib/utils';
import { PaymentDetailDialog } from './payment-detail-dialog';
import { PaymentDialog } from './payment-dialog';
import { PaymentStatusBadge } from './payment-status-badge';
import { Amount } from '@/components/shared/amount';

type Tab = 'list' | 'cheques' | 'journal';
const TABS: Tab[] = ['list', 'cheques', 'journal'];

export function VersementsPage() {
  const t = useTranslations('payments');
  const [tab, setTab] = useState<Tab>('list');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

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
      <div
        role="tablist"
        aria-label={t('title')}
        className="inline-flex w-fit flex-wrap rounded-md border p-0.5"
        onKeyDown={(e) => {
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
          const rtl = document.documentElement.dir === 'rtl';
          const forward = (e.key === 'ArrowRight') !== rtl;
          const next =
            TABS[(TABS.indexOf(tab) + (forward ? 1 : TABS.length - 1)) % TABS.length] ?? 'list';
          setTab(next);
          document.getElementById(`tab-${next}`)?.focus();
        }}
      >
        {TABS.map((k) => (
          <button
            key={k}
            id={`tab-${k}`}
            type="button"
            role="tab"
            aria-selected={tab === k}
            aria-controls={`panel-${k}`}
            tabIndex={tab === k ? 0 : -1}
            onClick={() => setTab(k)}
            className={cn(
              'rounded px-3 py-1.5 text-sm font-medium transition-colors',
              tab === k
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(`tab_${k}`)}
          </button>
        ))}
      </div>
      <div
        id={`panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        className="grid grid-cols-[minmax(0,1fr)] gap-4"
      >
        {tab === 'journal' ? (
          <CashJournal />
        ) : (
          <PaymentsTable cheques={tab === 'cheques'} onOpen={setOpenId} />
        )}
      </div>

      {creating ? <PaymentDialog open onOpenChange={(o) => !o && setCreating(false)} /> : null}
      {openId ? (
        <PaymentDetailDialog id={openId} open onOpenChange={(o) => !o && setOpenId(null)} />
      ) : null}
    </>
  );
}

function PaymentsTable({ cheques, onOpen }: { cheques: boolean; onOpen: (id: string) => void }) {
  const t = useTranslations('payments');
  const ts = useTranslations('sales');
  const format = useFormatter();
  const today = todayInAlgiers();
  const [filters, setFilters] = useState<PaymentFilters>({
    clientId: '',
    mode: '',
    status: '',
    from: '',
    to: '',
    sort: 'receivedAt',
  });
  const effective: PaymentFilters = cheques
    ? { ...filters, mode: 'CHEQUE', status: 'VALID', sort: 'dueDate' }
    : filters;
  const pages = usePaymentPages(effective);
  const clients = useClientPages({ search: '', hasDebt: false, overLimit: false });
  const items = useMemo(() => pages.data?.pages.flatMap((p) => p.items) ?? [], [pages.data]);
  const set = (patch: Partial<PaymentFilters>) => setFilters((f) => ({ ...f, ...patch }));

  const columns = useMemo<ColumnDef<PaymentDto>[]>(
    () => [
      {
        id: 'number',
        meta: { card: 'title' },
        header: t('colNumber'),
        cell: ({ row }) => (
          <button
            type="button"
            dir="ltr"
            className="font-medium tabular-nums underline-offset-4 hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(row.original.id);
            }}
          >
            {row.original.number}
          </button>
        ),
      },
      {
        id: 'date',
        header: cheques ? t('dueDate') : t('receivedAt'),
        cell: ({ row }) => {
          const p = row.original;
          if (!cheques)
            return format.dateTime(new Date(p.receivedAt), {
              dateStyle: 'medium',
              timeStyle: 'short',
            });
          if (!p.dueDate) return <span className="text-muted-foreground">—</span>;
          const overdue = p.dueDate < today;
          return (
            <span className={cn(overdue && 'font-medium text-destructive')}>
              {format.dateTime(new Date(`${p.dueDate}T12:00:00Z`), { dateStyle: 'medium' })}
              {overdue ? <span className="ms-1 text-xs">({t('overdue')})</span> : null}
            </span>
          );
        },
      },
      {
        id: 'client',
        meta: { card: 'subtitle' },
        header: t('client'),
        cell: ({ row }) =>
          row.original.client?.name ?? (
            <span className="text-muted-foreground">{ts('counterClient')}</span>
          ),
      },
      {
        id: 'mode',
        header: t('mode'),
        cell: ({ row }) => (
          <div>
            <p>{ts(`mode${row.original.mode}`)}</p>
            {row.original.reference ? (
              <p dir="ltr" className="text-start text-xs text-muted-foreground rtl:text-end">
                {[row.original.reference, row.original.bank].filter(Boolean).join(' · ')}
              </p>
            ) : null}
          </div>
        ),
      },
      {
        id: 'amount',
        meta: { card: 'end' },
        header: t('amount'),
        cell: ({ row }) => (
          <span dir="ltr" className="num whitespace-nowrap font-medium">
            <Amount value={row.original.amount} />
          </span>
        ),
      },
      {
        id: 'by',
        header: t('receivedBy'),
        cell: ({ row }) => row.original.receivedBy?.fullName ?? '—',
      },
      {
        id: 'status',
        meta: { card: 'badge' },
        header: t('status'),
        cell: ({ row }) => <PaymentStatusBadge status={row.original.status} />,
      },
    ],
    [t, ts, format, cheques, onOpen, today],
  );
  const table = useReactTable({ data: items, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <>
      {cheques ? (
        <p className="text-sm text-muted-foreground">{t('chequesHelp')}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-5">
          <div className="space-y-1">
            <Label htmlFor="pf-client">{t('client')}</Label>
            <NativeSelect
              id="pf-client"
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
            <Label htmlFor="pf-mode">{t('mode')}</Label>
            <NativeSelect
              id="pf-mode"
              value={filters.mode}
              onChange={(e) => set({ mode: e.target.value as PaymentFilters['mode'] })}
            >
              <option value="">{t('allModes')}</option>
              <option value="ESPECES">{ts('modeESPECES')}</option>
              <option value="CHEQUE">{ts('modeCHEQUE')}</option>
              <option value="VIREMENT">{ts('modeVIREMENT')}</option>
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="pf-status">{t('status')}</Label>
            <NativeSelect
              id="pf-status"
              value={filters.status}
              onChange={(e) => set({ status: e.target.value as PaymentFilters['status'] })}
            >
              <option value="">{t('allStatuses')}</option>
              <option value="VALID">{ts('paymentVALID')}</option>
              <option value="CANCELLED">{ts('paymentCANCELLED')}</option>
              <option value="BOUNCED">{ts('paymentBOUNCED')}</option>
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="pf-from">{t('from')}</Label>
            <Input
              id="pf-from"
              type="date"
              dir="ltr"
              value={filters.from}
              onChange={(e) => set({ from: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pf-to">{t('to')}</Label>
            <Input
              id="pf-to"
              type="date"
              dir="ltr"
              value={filters.to}
              onChange={(e) => set({ to: e.target.value })}
            />
          </div>
        </div>
      )}
      <DataTable
        table={table}
        caption={cheques ? t('tab_cheques') : t('tab_list')}
        isLoading={pages.isPending}
        onRowClick={(p) => onOpen(p.id)}
        emptyState={
          <EmptyState
            icon={Banknote}
            title={cheques ? t('noCheques') : t('emptyTitle')}
            description={cheques ? undefined : t('emptyDescription')}
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

function CashJournal() {
  const t = useTranslations('payments');
  const ts = useTranslations('sales');
  const [date, setDate] = useState(todayInAlgiers());
  const summary = useCashSummary(date);
  const s = summary.data;

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="journal-date">{t('journalDate')}</Label>
          <Input
            id="journal-date"
            type="date"
            dir="ltr"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-44 max-md:w-full"
          />
        </div>
        <p className="text-sm text-muted-foreground">{t('journalHelp')}</p>
      </div>
      {!s ? (
        <Skeleton className="h-40 w-full" aria-busy />
      ) : (
        <div className="grid gap-4 md:grid-cols-[18rem_minmax(0,1fr)]">
          <Card className="gap-3 py-4">
            <CardHeader>
              <CardTitle role="heading" aria-level={2} className="text-base">
                {t('journalTotal')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p dir="ltr" className="num text-start text-3xl font-semibold rtl:text-end">
                <Amount value={s.total} />
              </p>
              <p className="text-sm text-muted-foreground">
                {t('journalCount', { count: s.count })}
              </p>
              <dl className="space-y-1 border-t pt-3 text-sm">
                {s.byMode.length === 0 ? (
                  <p className="text-muted-foreground">{t('journalEmpty')}</p>
                ) : null}
                {s.byMode.map((m) => (
                  <div key={m.mode} className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">
                      {ts(`mode${m.mode}`)} ({m.count})
                    </dt>
                    <dd dir="ltr" className="num font-medium">
                      <Amount value={m.total} />
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
          <Card className="gap-3 py-4">
            <CardHeader>
              <CardTitle role="heading" aria-level={2} className="text-base">
                {t('journalByUser')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {s.byUser.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('journalEmpty')}</p>
              ) : (
                <ul className="divide-y text-sm">
                  {s.byUser.map((u) => (
                    <li
                      key={u.user?.id ?? 'none'}
                      className="flex flex-wrap items-center justify-between gap-2 py-2"
                    >
                      <div>
                        <p className="font-medium">{u.user?.fullName ?? '—'}</p>
                        <p className="text-xs text-muted-foreground">
                          {u.byMode.map((m) => ts(`mode${m.mode}`)).join(' · ')} ·{' '}
                          {t('journalCount', { count: u.count })}
                        </p>
                      </div>
                      <span dir="ltr" className="num font-semibold">
                        <Amount value={u.total} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
