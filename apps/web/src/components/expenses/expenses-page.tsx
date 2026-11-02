'use client';

import { type ColumnDef, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { Ban, ChartColumn, Loader2, Plus, ReceiptText, Tags, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  type ExpenseDto,
  ExpenseCategoryKey,
  Feature,
  PAYMENT_MODES,
  Permission,
} from '@erp/shared';
import { Amount } from '@/components/shared/amount';
import { EmptyState } from '@/components/shared/empty-state';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable } from '@/components/table/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { useFeature, usePermission } from '@/lib/auth';
import {
  type ExpenseFilters,
  useArchiveCategory,
  useCancelExpense,
  useExpenseCategories,
  useExpensePages,
  useRentContracts,
  useSaveCategory,
} from '@/lib/expenses';
import { useErrorMessage } from '@/lib/use-error-message';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';
import { cn } from '@/lib/utils';
import { useWarehouseFilter } from '@/lib/warehouse-scope';
import { DayText } from './day-text';
import { ExpenseDialog } from './expense-dialog';
import { RentBlock } from './rent-block';

type Tab = 'list' | 'rent';
const TABS: Tab[] = ['list', 'rent'];

/** Dépenses (phase 25): the list, fast entry, and the baux. */
export function ExpensesPage() {
  return (
    <FeatureGate feature={Feature.EXPENSES}>
      <Expenses />
    </FeatureGate>
  );
}

function Expenses() {
  const t = useTranslations('expenses');
  const canCreate = usePermission(Permission.EXPENSES_CREATE);
  const canManage = usePermission(Permission.RENT_MANAGE);
  const canReport = usePermission(Permission.REPORTS_FINANCE);
  const warehouseId = useWarehouseFilter();
  const contracts = useRentContracts(warehouseId);
  const rentAlert = (contracts.data ?? []).some((c) => c.alerts.length > 0);
  const [tab, setTab] = useState<Tab>('list');
  const [creating, setCreating] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          canCreate ? (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              {t('new')}
            </Button>
          ) : undefined
        }
        more={[
          canManage && {
            label: t('categories'),
            icon: Tags,
            onSelect: () => setCategoriesOpen(true),
          },
          canReport && { label: t('chargesLink'), icon: ChartColumn, href: '/rapports/charges' },
        ]}
      />
      <div
        role="tablist"
        aria-label={t('title')}
        className="inline-flex w-fit rounded-md border p-0.5"
        onKeyDown={(e) => {
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
          const next = tab === 'list' ? 'rent' : 'list';
          setTab(next);
          document.getElementById(`exp-tab-${next}`)?.focus();
        }}
      >
        {TABS.map((k) => (
          <button
            key={k}
            id={`exp-tab-${k}`}
            type="button"
            role="tab"
            aria-selected={tab === k}
            aria-controls={`exp-panel-${k}`}
            tabIndex={tab === k ? 0 : -1}
            onClick={() => setTab(k)}
            className={cn(
              'inline-flex min-h-11 items-center gap-2 rounded px-4 text-sm font-medium transition-colors',
              tab === k
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(`tab_${k}`)}
            {k === 'rent' && rentAlert ? (
              <span className="size-2 rounded-full bg-destructive" aria-label={t('rentAlert')} />
            ) : null}
          </button>
        ))}
      </div>
      <div
        id={`exp-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`exp-tab-${tab}`}
        className="grid grid-cols-[minmax(0,1fr)] gap-4"
      >
        {tab === 'list' ? <ExpensesTable /> : <RentBlock warehouseId={warehouseId} />}
      </div>
      {creating ? <ExpenseDialog open onOpenChange={(o) => !o && setCreating(false)} /> : null}
      {categoriesOpen ? <CategoriesDialog onClose={() => setCategoriesOpen(false)} /> : null}
    </>
  );
}

function ExpensesTable() {
  const t = useTranslations('expenses');
  const ts = useTranslations('sales');
  const multiUnit = useFeature(Feature.MULTI_UNIT);
  const canCancel = usePermission(Permission.EXPENSE_CANCEL);
  const categories = useExpenseCategories();
  const [filters, setFilters] = useState<ExpenseFilters>({
    categoryId: '',
    mode: '',
    status: '',
    from: '',
    to: '',
  });
  const set = (patch: Partial<ExpenseFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const pages = useExpensePages(filters);
  const items = useMemo(() => pages.data?.pages.flatMap((p) => p.items) ?? [], [pages.data]);
  const [cancelling, setCancelling] = useState<ExpenseDto | null>(null);

  const columns = useMemo<ColumnDef<ExpenseDto>[]>(
    () => [
      {
        id: 'category',
        meta: { card: 'title' },
        header: t('category'),
        cell: ({ row }) => (
          <span className="block truncate font-medium" title={row.original.category.name}>
            {row.original.category.name}
          </span>
        ),
      },
      {
        id: 'payee',
        meta: { card: 'subtitle' },
        header: t('payee'),
        cell: ({ row }) => (
          <span className="block truncate">
            {[row.original.payee, row.original.number].filter(Boolean).join(' · ')}
          </span>
        ),
      },
      {
        id: 'date',
        meta: { card: 'field' },
        header: t('date'),
        cell: ({ row }) => (
          <span>
            <DayText day={row.original.date} />
            {row.original.periodStart && row.original.periodEnd ? (
              <span className="block text-xs text-muted-foreground">
                {t('covers')} <DayText day={row.original.periodStart} /> →{' '}
                <DayText day={row.original.periodEnd} />
              </span>
            ) : null}
          </span>
        ),
      },
      ...(multiUnit
        ? [
            {
              id: 'depot',
              meta: { card: 'field' as const },
              header: t('depot'),
              cell: ({ row }: { row: { original: ExpenseDto } }) =>
                row.original.warehouse?.name ?? '—',
            },
          ]
        : []),
      {
        id: 'mode',
        meta: { card: 'hidden' },
        header: t('mode'),
        cell: ({ row }) => ts(`mode${row.original.mode}`),
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
        id: 'status',
        meta: { card: 'badge' },
        header: t('status'),
        cell: ({ row }) =>
          row.original.status === 'CANCELLED' ? (
            <Badge variant="outline">{t('statusCANCELLED')}</Badge>
          ) : row.original.rentContractId ? (
            <Badge variant="secondary">{t('rentPayment')}</Badge>
          ) : null,
      },
      {
        id: 'actions',
        meta: { card: 'actions' },
        header: () => <span className="sr-only">{t('actions')}</span>,
        cell: ({ row }) =>
          canCancel && row.original.status === 'VALID' ? (
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11"
              onClick={(e) => {
                e.stopPropagation();
                setCancelling(row.original);
              }}
            >
              <Ban aria-hidden />
              {t('cancelExpense')}
            </Button>
          ) : null,
      },
    ],
    [t, ts, multiUnit, canCancel],
  );
  const table = useReactTable({ data: items, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="col-span-2 space-y-1 sm:col-span-1">
          <Label htmlFor="ef-category">{t('category')}</Label>
          <NativeSelect
            id="ef-category"
            value={filters.categoryId}
            onChange={(e) => set({ categoryId: e.target.value })}
          >
            <option value="">{t('allCategories')}</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ef-mode">{t('mode')}</Label>
          <NativeSelect
            id="ef-mode"
            value={filters.mode}
            onChange={(e) => set({ mode: e.target.value as ExpenseFilters['mode'] })}
          >
            <option value="">{t('allModes')}</option>
            {PAYMENT_MODES.map((m) => (
              <option key={m} value={m}>
                {ts(`mode${m}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ef-status">{t('status')}</Label>
          <NativeSelect
            id="ef-status"
            value={filters.status}
            onChange={(e) => set({ status: e.target.value as ExpenseFilters['status'] })}
          >
            <option value="">{t('allStatuses')}</option>
            <option value="VALID">{t('statusVALID')}</option>
            <option value="CANCELLED">{t('statusCANCELLED')}</option>
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ef-from">{t('from')}</Label>
          <Input
            id="ef-from"
            type="date"
            dir="ltr"
            value={filters.from}
            onChange={(e) => set({ from: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ef-to">{t('to')}</Label>
          <Input
            id="ef-to"
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
      {cancelling ? (
        <CancelExpenseDialog expense={cancelling} onClose={() => setCancelling(null)} />
      ) : null}
    </>
  );
}

function CancelExpenseDialog({ expense, onClose }: { expense: ExpenseDto; onClose: () => void }) {
  const t = useTranslations('expenses');
  const errorMessage = useErrorMessage();
  const cancel = useCancelExpense();
  const key = useIdempotencyKey(true);
  const [reason, setReason] = useState('');
  const valid = reason.trim().length >= 3;

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent className="md:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid || cancel.isPending) return;
            cancel.mutate(
              { id: expense.id, reason: reason.trim(), key },
              {
                onSuccess: () => {
                  toast.success(t('cancelled', { number: expense.number }));
                  onClose();
                },
                onError: (err) => toast.error(errorMessage(err)),
              },
            );
          }}
        >
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {t('cancelTitle', { number: expense.number })}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>{t('cancelHelp')}</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="exp-cancel-reason">{t('reason')}</Label>
            <Input
              id="exp-cancel-reason"
              autoFocus
              maxLength={255}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <ResponsiveDialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('cancelButton')}
            </Button>
            <Button type="submit" variant="destructive" disabled={!valid || cancel.isPending}>
              {cancel.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t('confirmCancel')}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function CategoriesDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations('expenses');
  const errorMessage = useErrorMessage();
  const categories = useExpenseCategories();
  const save = useSaveCategory();
  const archive = useArchiveCategory();
  const [name, setName] = useState('');

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent className="md:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('categories')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{t('categoriesHelp')}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ul className="divide-y rounded-md border">
          {(categories.data ?? []).map((c) => (
            <li key={c.id} className="flex min-h-11 items-center justify-between gap-2 ps-3">
              <span className="min-w-0 truncate">{c.name}</span>
              {c.key === ExpenseCategoryKey.RENT ? (
                <span className="pe-3 text-xs text-muted-foreground">{t('rentCategory')}</span>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11"
                  aria-label={t('archiveCategory', { name: c.name })}
                  disabled={archive.isPending}
                  onClick={() =>
                    archive.mutate(c.id, { onError: (err) => toast.error(errorMessage(err)) })
                  }
                >
                  <Trash2 aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim() || save.isPending) return;
            save.mutate(
              { id: null, name: name.trim() },
              {
                onSuccess: () => setName(''),
                onError: (err) => toast.error(errorMessage(err)),
              },
            );
          }}
        >
          <div className="min-w-0 flex-1 space-y-2">
            <Label htmlFor="exp-new-category">{t('newCategory')}</Label>
            <Input
              id="exp-new-category"
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <Button type="submit" className="min-h-11" disabled={!name.trim() || save.isPending}>
            <Plus aria-hidden />
            {t('add')}
          </Button>
        </form>
        <ResponsiveDialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('close')}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
