'use client';

import {
  ArrowLeftRight,
  Archive,
  Calculator,
  Landmark,
  Loader2,
  Pencil,
  Plus,
  TriangleAlert,
  Undo2,
  Wallet,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  type CashAccountDto,
  type CashMovementDto,
  Feature,
  money,
  Permission,
  type TreasuryAccountSummary,
} from '@erp/shared';
import { Amount } from '@/components/shared/amount';
import { EmptyState } from '@/components/shared/empty-state';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermission } from '@/lib/auth';
import {
  useArchiveCashAccount,
  useCashAccounts,
  useCashMovements,
  useTreasurySummary,
} from '@/lib/treasury';
import { useErrorMessage } from '@/lib/use-error-message';
import { cn, isolateLtr } from '@/lib/utils';
import {
  AccountDialog,
  CancelTransferDialog,
  CountDialog,
  OpeningDialog,
  TransferDialog,
} from './treasury-dialogs';

/** Trésorerie (phase 34): one card per account, its movements, and what moves money by hand. */
export function TreasuryPage() {
  return (
    <FeatureGate feature={Feature.TREASURY}>
      <Treasury />
    </FeatureGate>
  );
}

type Open =
  | { kind: 'transfer'; from?: string }
  | { kind: 'count' | 'opening' | 'edit'; account: CashAccountDto }
  | { kind: 'new' }
  | null;

function Treasury() {
  const t = useTranslations('treasury');
  const canView = usePermission(Permission.TREASURY_VIEW);
  const canOperate = usePermission(Permission.TREASURY_OPERATE);
  const canManage = usePermission(Permission.TREASURY_MANAGE);
  const errorMessage = useErrorMessage();
  const summary = useTreasurySummary();
  const accounts = useCashAccounts(false, canView);
  const archive = useArchiveCashAccount();
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const close = (o: boolean) => {
    if (!o) setOpen(null);
  };

  const list = accounts.data ?? [];
  const rows = summary.data?.accounts ?? [];
  const current = selected ?? rows[0]?.account.id ?? null;
  const currentName = rows.find((r) => r.account.id === current)?.account.name ?? '';
  const totals = summary.data?.totals;

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          canOperate && list.length > 1 ? (
            <Button onClick={() => setOpen({ kind: 'transfer' })}>
              <ArrowLeftRight aria-hidden />
              {t('transfer')}
            </Button>
          ) : undefined
        }
        more={[
          canManage && {
            label: t('newAccount'),
            icon: Plus,
            onSelect: () => setOpen({ kind: 'new' }),
          },
        ]}
      />

      {totals ? (
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Total label={t('totalCaisses')} value={totals.caisses} strong />
          <Total label={t('totalBanques')} value={totals.banques} strong />
          <Total label={t('cashInToday')} value={totals.cashIn} />
          <Total label={t('cashOutToday')} value={totals.cashOut} />
        </dl>
      ) : (
        <Skeleton className="h-20 w-full" />
      )}

      {summary.data?.alerts.length ? (
        <Card className="border-destructive/50 py-0" role="status">
          <CardContent className="grid gap-2 p-4">
            <h2 className="flex items-center gap-2 font-semibold">
              <TriangleAlert className="size-4 text-destructive" aria-hidden />
              {t('alertsTitle')}
            </h2>
            <ul className="grid gap-1 text-sm">
              {summary.data.alerts.slice(0, 5).map((a) => (
                <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="min-w-0 truncate">
                    <bdi>{a.account.name}</bdi>
                    {a.reason ? ' · ' : ''}
                    {a.reason ? <bdi>{a.reason}</bdi> : null}
                  </span>
                  <Amount value={a.ecart} className="font-medium" />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {summary.isPending ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : summary.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(summary.error)}
        </p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => {
            const account = list.find((a) => a.id === row.account.id);
            return (
              <li key={row.account.id} className="min-w-0">
                <AccountCard
                  row={row}
                  selected={row.account.id === current}
                  onSelect={() => setSelected(row.account.id)}
                  onCount={
                    canOperate && account && row.account.type === 'CAISSE'
                      ? () => setOpen({ kind: 'count', account })
                      : undefined
                  }
                  onOpening={
                    canManage && account && !row.account.openingDate
                      ? () => setOpen({ kind: 'opening', account })
                      : undefined
                  }
                  onEdit={
                    canManage && account ? () => setOpen({ kind: 'edit', account }) : undefined
                  }
                  onArchive={
                    canManage && !row.account.isDefault && money(row.balance).isZero()
                      ? () =>
                          archive.mutate(row.account.id, {
                            onSuccess: () => {
                              setSelected(null);
                              toast.success(t('archived'));
                            },
                            onError: (err) => toast.error(errorMessage(err)),
                          })
                      : undefined
                  }
                />
              </li>
            );
          })}
        </ul>
      )}

      {current ? <Movements accountId={current} name={currentName} canCancel={canOperate} /> : null}

      {open?.kind === 'transfer' ? (
        <TransferDialog accounts={list} from={open.from} open onOpenChange={close} />
      ) : null}
      {open?.kind === 'count' ? (
        <CountDialog account={open.account} open onOpenChange={close} />
      ) : null}
      {open?.kind === 'opening' ? (
        <OpeningDialog account={open.account} open onOpenChange={close} />
      ) : null}
      {open?.kind === 'edit' ? (
        <AccountDialog account={open.account} open onOpenChange={close} />
      ) : null}
      {open?.kind === 'new' ? <AccountDialog account={null} open onOpenChange={close} /> : null}
    </>
  );
}

function Total({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg border bg-card p-3">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('mt-1 text-sm', strong && 'text-base font-semibold')}>
        <Amount value={value} />
      </dd>
    </div>
  );
}

function AccountCard({
  row,
  selected,
  onSelect,
  onCount,
  onOpening,
  onEdit,
  onArchive,
}: {
  row: TreasuryAccountSummary;
  selected: boolean;
  onSelect: () => void;
  onCount?: () => void;
  onOpening?: () => void;
  onEdit?: () => void;
  onArchive?: () => void;
}) {
  const t = useTranslations('treasury');
  const a = row.account;
  const Icon = a.type === 'CAISSE' ? Wallet : Landmark;
  return (
    <Card className={cn('h-full py-0', selected && 'border-primary')}>
      <CardContent className="grid gap-3 p-4">
        <button
          type="button"
          aria-pressed={selected}
          aria-label={t('showMovements', { name: a.name })}
          onClick={onSelect}
          className="grid min-h-11 gap-2 rounded-md text-start"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-medium">
              <bdi>{a.name}</bdi>
            </span>
            <Badge variant="secondary">{t(`type_${a.type}`)}</Badge>
          </span>
          {a.warehouse ? (
            <span className="truncate text-xs text-muted-foreground">
              <bdi>{a.warehouse.name}</bdi>
            </span>
          ) : null}
          <span>
            <Amount value={row.balance} className="text-2xl font-semibold" />
          </span>
          <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              {t('in')} <Amount value={row.cashIn} />
            </span>
            <span>
              {t('out')} <Amount value={row.cashOut} />
            </span>
          </span>
          {a.openingDate ? null : (
            <span className="text-xs text-muted-foreground">{t('noOpening')}</span>
          )}
        </button>
        {onCount || onOpening || onEdit || onArchive ? (
          <div className="flex flex-wrap gap-2">
            {onCount ? (
              <Button variant="outline" size="sm" className="min-h-11" onClick={onCount}>
                <Calculator aria-hidden />
                {t('count')}
              </Button>
            ) : null}
            {onOpening ? (
              <Button variant="outline" size="sm" className="min-h-11" onClick={onOpening}>
                {t('opening')}
              </Button>
            ) : null}
            {onEdit ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-11"
                aria-label={t('editAccountOf', { name: a.name })}
                onClick={onEdit}
              >
                <Pencil aria-hidden />
              </Button>
            ) : null}
            {onArchive ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-11"
                aria-label={t('archiveAccountOf', { name: a.name })}
                onClick={onArchive}
              >
                <Archive aria-hidden />
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Movements({
  accountId,
  name,
  canCancel,
}: {
  accountId: string;
  name: string;
  canCancel: boolean;
}) {
  const t = useTranslations('treasury');
  const errorMessage = useErrorMessage();
  const pages = useCashMovements(accountId);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];
  const reversed = new Set(items.filter((m) => m.type === 'REVERSAL').map((m) => m.refId));

  return (
    <section aria-labelledby="movements-title" className="grid gap-3">
      <h2 id="movements-title" className="min-w-0 truncate font-semibold">
        {t('movementsOf', { name: isolateLtr(name) })}
      </h2>
      {pages.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : pages.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(pages.error)}
        </p>
      ) : items.length === 0 ? (
        <EmptyState icon={Wallet} title={t('noMovements')} />
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {items.map((m) => (
            <Row
              key={m.id}
              m={m}
              onCancel={
                canCancel &&
                m.refType === 'CashTransfer' &&
                m.refId &&
                m.type !== 'REVERSAL' &&
                !reversed.has(m.refId)
                  ? () => setCancelling(m.refId)
                  : undefined
              }
            />
          ))}
        </ul>
      )}
      {pages.hasNextPage ? (
        <Button
          variant="outline"
          className="min-h-11 justify-self-center"
          disabled={pages.isFetchingNextPage}
          onClick={() => void pages.fetchNextPage()}
        >
          {pages.isFetchingNextPage ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {t('loadMore')}
        </Button>
      ) : null}
      {cancelling ? (
        <CancelTransferDialog
          transferId={cancelling}
          open
          onOpenChange={(o) => !o && setCancelling(null)}
        />
      ) : null}
    </section>
  );
}

function Row({ m, onCancel }: { m: CashMovementDto; onCancel?: () => void }) {
  const t = useTranslations('treasury');
  const format = useFormatter();
  const negative = money(m.amount).isNegative();
  return (
    <li className={cn('flex items-center gap-3 p-3', !m.counted && 'opacity-70')}>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate text-sm font-medium">{t(`movement_${m.type}`)}</span>
        {m.note ? (
          <span className="truncate text-xs text-muted-foreground">
            <bdi>{m.note}</bdi>
          </span>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {format.dateTime(new Date(`${m.date}T12:00:00Z`), { dateStyle: 'medium' })}
          {m.counted ? '' : ` · ${t('beforeOpening')}`}
        </span>
      </div>
      <div className="grid shrink-0 justify-items-end gap-0.5">
        <Amount
          value={m.amount}
          className={cn('text-sm font-medium', negative && 'text-destructive')}
        />
        {m.runningBalance !== null ? (
          <Amount value={m.runningBalance} className="text-xs text-muted-foreground" />
        ) : null}
      </div>
      {onCancel ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-11 shrink-0"
          aria-label={t('cancelTransfer')}
          onClick={onCancel}
        >
          <Undo2 aria-hidden />
        </Button>
      ) : null}
    </li>
  );
}
