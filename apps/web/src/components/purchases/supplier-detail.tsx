'use client';

import { ArrowLeft, Ban, Banknote, FileText, Loader2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { money, type SupplierDto, type SupplierPaymentDto } from '@erp/shared';
import { Amount } from '@/components/shared/amount';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { PrintButton } from '@/components/shared/print-button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useCanManageCredit } from '@/lib/clients';
import { useSupplier, useSupplierLedger, useSupplierPayments } from '@/lib/credit';
import { todayInAlgiers } from '@/lib/purchases';
import { useErrorMessage } from '@/lib/use-error-message';
import { cn } from '@/lib/utils';
import { SupplierBalance } from './supplier-balance';
import { CancelSupplierPaymentDialog, SupplierPaymentDialog } from './supplier-payment-dialog';

/** Fiche fournisseur (phase 21): what we owe, règlements, relevé and account history. */
export function SupplierDetail({ supplierId }: { supplierId: string }) {
  const t = useTranslations('supplierAccount');
  const errorMessage = useErrorMessage();
  const canManage = useCanManageCredit();
  const supplier = useSupplier(supplierId);
  const [paying, setPaying] = useState(false);

  if (supplier.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{errorMessage(supplier.error)}</AlertDescription>
      </Alert>
    );
  }
  const s = supplier.data;
  const live = s !== undefined && s.archivedAt === null;

  return (
    <>
      <PageHeader
        title={s?.name ?? t('title')}
        description={s ? [s.code, s.phone].filter(Boolean).join(' · ') || ' ' : ' '}
        more={[
          {
            label: t('back'),
            icon: ArrowLeft,
            flipIcon: true,
            tone: 'ghost',
            href: '/achats/fournisseurs',
          },
        ]}
        actions={
          canManage && (live || !s) ? (
            <Button disabled={!live} onClick={() => setPaying(true)}>
              <Banknote aria-hidden />
              {t('newPayment')}
            </Button>
          ) : null
        }
      />
      {!canManage ? (
        <Alert role="status">
          <AlertDescription>{t('managersOnly')}</AlertDescription>
        </Alert>
      ) : s ? (
        <>
          <Card className="py-4">
            <CardContent className="space-y-1">
              <p className="text-sm text-muted-foreground">{t('balance')}</p>
              <SupplierBalance value={s.balance} className="text-2xl font-semibold" />
              {s.currency !== 'DZD' ? (
                <SupplierBalance
                  value={s.balanceCurrency}
                  currency={s.currency}
                  showHint={false}
                  className="text-lg"
                />
              ) : null}
            </CardContent>
          </Card>
          <Payments supplierId={s.id} />
          <Statement supplier={s} />
          <Ledger supplierId={s.id} />
        </>
      ) : (
        <div className="grid gap-4" aria-busy>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}
      {s && paying ? <SupplierPaymentDialog supplier={s} open onOpenChange={setPaying} /> : null}
    </>
  );
}

function Payments({ supplierId }: { supplierId: string }) {
  const t = useTranslations('supplierAccount');
  const ts = useTranslations('sales');
  const format = useFormatter();
  const payments = useSupplierPayments(supplierId);
  const [cancelling, setCancelling] = useState<SupplierPaymentDto | null>(null);
  const items = payments.data?.items ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {t('paymentsTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        {payments.isPending ? (
          <Skeleton className="mx-4 h-16" aria-busy />
        ) : items.length === 0 ? (
          <EmptyState icon={Banknote} title={t('noPayments')} />
        ) : (
          <ul className="divide-y">
            {items.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span dir="ltr" className="font-medium">
                      {p.number}
                    </span>
                    <Badge variant="secondary" className="font-normal">
                      {ts(`mode${p.mode}`)}
                    </Badge>
                    {p.status === 'CANCELLED' ? (
                      <Badge variant="outline">{t('statusCANCELLED')}</Badge>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {format.dateTime(new Date(p.paidAt), { dateStyle: 'medium' })}
                    {p.reference ? (
                      <>
                        {' · '}
                        <bdi dir="ltr">{p.reference}</bdi>
                      </>
                    ) : null}
                    {p.dueDate
                      ? ` · ${t('dueOn', {
                          date: format.dateTime(new Date(`${p.dueDate}T12:00:00Z`), {
                            dateStyle: 'medium',
                          }),
                        })}`
                      : ''}
                  </p>
                  {p.cancelReason ? (
                    <p className="text-xs text-muted-foreground">{p.cancelReason}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="text-end">
                    <Amount
                      value={p.amount}
                      className={cn(
                        p.status === 'CANCELLED' && 'text-muted-foreground line-through',
                      )}
                    />
                    {p.amountCurrency ? (
                      <span dir="ltr" className="num block text-xs text-muted-foreground">
                        {p.amountCurrency} {p.currency}
                      </span>
                    ) : null}
                  </span>
                  {/* Paid at reception (phase 34): it is cancelled with its BR. */}
                  {p.status === 'VALID' && !p.purchase ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('cancelPayment', { number: p.number })}
                      onClick={() => setCancelling(p)}
                    >
                      <Ban aria-hidden />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {cancelling ? (
        <CancelSupplierPaymentDialog
          payment={cancelling}
          open
          onOpenChange={(o) => !o && setCancelling(null)}
        />
      ) : null}
    </Card>
  );
}

function Statement({ supplier }: { supplier: SupplierDto }) {
  const t = useTranslations('supplierAccount');
  const tc = useTranslations('clients');
  const [range, setRange] = useState(() => {
    const today = todayInAlgiers();
    return { from: `${today.slice(0, 8)}01`, to: today };
  });
  const badRange = range.from === '' || range.to === '' || range.from > range.to;
  return (
    <section aria-labelledby="sup-statement" className="grid gap-3">
      <div className="space-y-1">
        <h2 id="sup-statement" className="text-lg font-semibold">
          {t('statementTitle')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('statementHelp')}</p>
      </div>
      <div className="grid grid-cols-2 items-end gap-3 sm:flex">
        <div className="space-y-1">
          <Label htmlFor="sup-from">{tc('from')}</Label>
          <Input
            id="sup-from"
            type="date"
            dir="ltr"
            value={range.from}
            max={range.to || undefined}
            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sup-to">{tc('to')}</Label>
          <Input
            id="sup-to"
            type="date"
            dir="ltr"
            value={range.to}
            min={range.from || undefined}
            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
          />
        </div>
        {badRange ? null : (
          <PrintButton
            className="col-span-2"
            path={`/suppliers/${supplier.id}/statement/pdf?from=${range.from}&to=${range.to}`}
            fileName={`releve-${supplier.code ?? supplier.name}`}
          />
        )}
      </div>
      {badRange ? (
        <Alert role="status">
          <AlertDescription>{tc('badRange')}</AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}

function Ledger({ supplierId }: { supplierId: string }) {
  const t = useTranslations('supplierAccount');
  const tl = useTranslations('supplierLedgerTypes');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const ledger = useSupplierLedger(supplierId);
  const entries = ledger.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section aria-labelledby="sup-ledger" className="grid gap-3">
      <h2 id="sup-ledger" className="text-lg font-semibold">
        {t('ledgerTitle')}
      </h2>
      {ledger.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(ledger.error)}</AlertDescription>
        </Alert>
      ) : ledger.isPending ? (
        <Skeleton className="h-48 w-full" aria-busy />
      ) : entries.length === 0 ? (
        <Card>
          <EmptyState icon={FileText} title={t('noEntries')} />
        </Card>
      ) : (
        <ul aria-label={t('ledgerTitle')} className="divide-y rounded-lg border bg-card">
          {entries.map((e) => {
            const amount = money(e.amount);
            return (
              <li key={e.id} className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0 space-y-1">
                  <Badge variant="secondary" className="font-normal">
                    {tl(e.type)}
                  </Badge>
                  {e.label ? (
                    <p dir="auto" className="truncate text-sm">
                      {e.label}
                    </p>
                  ) : null}
                  {e.reason ? (
                    <p className="text-xs text-muted-foreground">
                      {e.reason === 'paid_at_reception' ? t('paidAtReception') : e.reason}
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    {format.dateTime(new Date(e.createdAt), {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                    {e.createdBy ? ` · ${e.createdBy.fullName}` : ''}
                  </p>
                </div>
                <div className="shrink-0 space-y-1 text-end">
                  <p
                    className={cn(
                      'font-medium',
                      amount.gt(0) ? 'text-destructive' : 'text-primary',
                    )}
                  >
                    <span className="sr-only">{amount.gt(0) ? t('debit') : t('credit')} </span>
                    <span aria-hidden>{amount.gt(0) ? '+' : '−'}</span>
                    <Amount value={amount.abs()} />
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('balance')} <Amount value={e.runningBalance} />
                  </p>
                  {e.amountCurrency ? (
                    <p dir="ltr" className="num text-xs text-muted-foreground">
                      {e.amountCurrency} {e.currency} · {e.runningBalanceCurrency} {e.currency}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {ledger.hasNextPage ? (
        <Button
          variant="outline"
          className="justify-self-center"
          disabled={ledger.isFetchingNextPage}
          onClick={() => void ledger.fetchNextPage()}
        >
          {ledger.isFetchingNextPage ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {t('loadMore')}
        </Button>
      ) : null}
    </section>
  );
}
