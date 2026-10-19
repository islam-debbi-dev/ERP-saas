'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, FileText, Pencil, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { formatDA, money, qty, type SaleResultDto } from '@erp/shared';
import { PageHeader } from '@/components/shared/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api-client';
import { useUnitLabel } from '@/lib/catalog';
import { useCanManageCredit } from '@/lib/clients';
import { todayInAlgiers } from '@/lib/purchases';
import { saleKeys, useSale } from '@/lib/sales';
import { formatQty } from '@/lib/stock';
import { useErrorMessage } from '@/lib/use-error-message';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';
import { PaymentDetailDialog } from '@/components/payments/payment-detail-dialog';
import { CancelSaleDialog, ReturnDialog } from './sale-dialogs';
import { SaleStatusBadge } from './sale-status-badge';

function Amount({ value, className }: { value: string; className?: string }) {
  return (
    <span dir="ltr" className={`num whitespace-nowrap ${className ?? ''}`}>
      {formatDA(value)}
    </span>
  );
}

export function SaleView({ id }: { id: string }) {
  const t = useTranslations('sales');
  const format = useFormatter();
  const unitLabel = useUnitLabel();
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const queryClient = useQueryClient();
  const canManage = useCanManageCredit();
  const sale = useSale(id);
  const [dialog, setDialog] = useState<'cancel' | 'return' | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const invoiceKey = useIdempotencyKey(true);

  const invoice = useMutation({
    mutationFn: () =>
      api.request<SaleResultDto>('/invoices/from-bls', {
        method: 'POST',
        body: { saleIds: [id], documentDate: todayInAlgiers() },
        idempotencyKey: invoiceKey,
      }),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: saleKeys.all });
      toast.success(t('invoiced', { number: r.sale.number ?? '' }));
      router.push(`/ventes/${r.sale.id}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (sale.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{errorMessage(sale.error)}</AlertDescription>
      </Alert>
    );
  }
  const s = sale.data;
  if (!s) return <Skeleton className="h-96 w-full" aria-busy />;

  const validated = s.status === 'VALIDATED';
  const grouped = s.sourceBls.length > 0;
  const returnsTtc = s.returns.reduce((sum, r) => sum.plus(r.totalTtc), money(0));
  const rest = money(s.totalTtc).minus(s.paidAmount).minus(returnsTtc);
  const day = (iso: string) =>
    format.dateTime(new Date(`${iso}T12:00:00Z`), { dateStyle: 'medium' });
  const at = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'short', timeStyle: 'short' });

  return (
    <>
      <PageHeader
        title={`${t(`type${s.type}`)} ${s.number ?? t('draft')}`}
        description={s.client ? s.client.name : t('counterClient')}
        actions={
          <>
            <Button asChild variant="ghost">
              <Link href="/ventes">
                <ArrowLeft className="rtl-flip" aria-hidden />
                {t('back')}
              </Link>
            </Button>
            {s.status === 'DRAFT' ? (
              <Button asChild>
                <Link href={`/ventes/nouvelle?brouillon=${s.id}`}>
                  <Pencil aria-hidden />
                  {t('resume')}
                </Link>
              </Button>
            ) : null}
            {validated && s.type === 'BL' && !s.invoice ? (
              <Button
                variant="outline"
                disabled={invoice.isPending}
                onClick={() => invoice.mutate()}
              >
                <FileText aria-hidden />
                {t('makeInvoice')}
              </Button>
            ) : null}
            {validated && canManage && !grouped ? (
              <Button variant="outline" onClick={() => setDialog('return')}>
                <Undo2 aria-hidden />
                {t('return')}
              </Button>
            ) : null}
            {s.status === 'DRAFT' || (validated && canManage && !s.invoice) ? (
              <Button
                variant="ghost"
                className="text-destructive"
                onClick={() => setDialog('cancel')}
              >
                <Ban aria-hidden />
                {s.status === 'DRAFT' ? t('abandon') : t('cancel')}
              </Button>
            ) : null}
          </>
        }
      />

      {s.status === 'CANCELLED' ? (
        <Alert role="status">
          <AlertDescription>
            {t('cancelledBanner', { reason: s.cancelReason ?? '' })}
          </AlertDescription>
        </Alert>
      ) : null}
      {s.invoice ? (
        <Alert role="status">
          <AlertDescription>
            {t('invoicedIn')}{' '}
            <Link
              href={`/ventes/${s.invoice.id}`}
              className="font-medium underline underline-offset-4"
              dir="ltr"
            >
              {s.invoice.number}
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="gap-3 py-4">
          <CardContent>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">{t('status')}</dt>
                <dd className="flex flex-wrap gap-1">
                  <SaleStatusBadge status={s.status} />
                  {s.creditOverride ? (
                    <Badge variant="destructive">{t('creditOverride')}</Badge>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('client')}</dt>
                <dd>
                  {s.client ? (
                    <Link
                      href={`/clients/${s.client.id}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {s.client.name}
                    </Link>
                  ) : (
                    t('counterClient')
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('date')}</dt>
                <dd>{day(s.documentDate)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('seller')}</dt>
                <dd>{s.seller?.fullName ?? '—'}</dd>
              </div>
              {s.validatedAt ? (
                <div>
                  <dt className="text-xs text-muted-foreground">{t('validatedAt')}</dt>
                  <dd>{at(s.validatedAt)}</dd>
                </div>
              ) : null}
              {grouped ? (
                <div className="sm:col-span-2 lg:col-span-3">
                  <dt className="text-xs text-muted-foreground">{t('sourceBls')}</dt>
                  <dd className="flex flex-wrap gap-2">
                    {s.sourceBls.map((b) => (
                      <Link
                        key={b.id}
                        href={`/ventes/${b.id}`}
                        dir="ltr"
                        className="underline underline-offset-4"
                      >
                        {b.number}
                      </Link>
                    ))}
                  </dd>
                </div>
              ) : null}
            </dl>
          </CardContent>
        </Card>

        <Card className="gap-3 py-4">
          <CardHeader>
            <CardTitle role="heading" aria-level={2} className="text-base">
              {t('totals')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t('totalHt')}</dt>
                <dd>
                  <Amount value={s.totalHt} />
                </dd>
              </div>
              {s.tvaByRate.map((r) => (
                <div key={r.rate} className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">
                    {t('tvaAt', { rate: money(r.rate).toString() })}
                  </dt>
                  <dd>
                    <Amount value={r.tva} />
                  </dd>
                </div>
              ))}
              <div className="flex justify-between gap-2 border-t pt-2 font-semibold">
                <dt>{t('totalTtc')}</dt>
                <dd>
                  <Amount value={s.totalTtc} />
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t('paid')}</dt>
                <dd>
                  <Amount value={s.paidAmount} />
                </dd>
              </div>
              {returnsTtc.gt(0) ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t('avoirs')}</dt>
                  <dd>
                    <Amount value={returnsTtc.toString()} />
                  </dd>
                </div>
              ) : null}
              {validated && !grouped ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t('onCredit')}</dt>
                  <dd>
                    <Amount
                      value={rest.toString()}
                      className={rest.gt(0) ? 'text-destructive' : ''}
                    />
                  </dd>
                </div>
              ) : null}
            </dl>
          </CardContent>
        </Card>
      </div>

      <div className="w-full overflow-x-auto rounded-lg border bg-card">
        <Table className="min-w-[44rem]">
          <caption className="sr-only">{t('linesCaption')}</caption>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead>{t('colProduct')}</TableHead>
              <TableHead className="text-end">{t('colQty')}</TableHead>
              <TableHead className="text-end">{t('colPrice')}</TableHead>
              <TableHead className="text-end">{t('colDiscount')}</TableHead>
              {s.assujettiTva ? <TableHead className="text-end">{t('colTva')}</TableHead> : null}
              <TableHead className="text-end">{t('colLineHt')}</TableHead>
              <TableHead className="text-end">{t('colReturned')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {s.lines.map((l) => {
              const returned = qty(l.returnedQtyBase).div(l.factorToBase);
              return (
                <TableRow key={l.id}>
                  <TableCell className="whitespace-normal font-medium">{l.designation}</TableCell>
                  <TableCell className="text-end">
                    <span className="num">{formatQty(l.qty)}</span>{' '}
                    {unitLabel({ code: l.unitCode, name: l.unitName })}
                  </TableCell>
                  <TableCell className="text-end">
                    <Amount value={l.unitPriceHt} />
                  </TableCell>
                  <TableCell className="text-end">
                    <span dir="ltr" className="num">
                      {money(l.discountPct).isZero() ? '—' : `${money(l.discountPct).toString()} %`}
                    </span>
                  </TableCell>
                  {s.assujettiTva ? (
                    <TableCell className="text-end">
                      <span dir="ltr" className="num">
                        {money(l.tvaRate).toString()} %
                      </span>
                    </TableCell>
                  ) : null}
                  <TableCell className="text-end">
                    <Amount value={l.lineHt} className="font-medium" />
                  </TableCell>
                  <TableCell className="text-end">
                    <span className="num">
                      {returned.isZero() ? '—' : formatQty(returned.toString())}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {s.payments.length > 0 || s.returns.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {s.payments.length > 0 ? (
            <Card className="gap-3 py-4">
              <CardHeader>
                <CardTitle role="heading" aria-level={2} className="text-base">
                  {t('payments')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y text-sm">
                  {s.payments.map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2"
                    >
                      <span>
                        <button
                          type="button"
                          dir="ltr"
                          className="font-medium underline-offset-4 hover:underline"
                          onClick={() => setPaymentId(p.id)}
                        >
                          {p.number}
                        </button>{' '}
                        <span className="text-muted-foreground">
                          · {t(`mode${p.mode as 'ESPECES'}`)}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        {p.status !== 'VALID' ? (
                          <Badge variant="outline">{t(`payment${p.status}`)}</Badge>
                        ) : null}
                        <Amount value={p.amount} />
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
          {s.returns.length > 0 ? (
            <Card className="gap-3 py-4">
              <CardHeader>
                <CardTitle role="heading" aria-level={2} className="text-base">
                  {t('avoirs')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y text-sm">
                  {s.returns.map((r) => (
                    <li
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2"
                    >
                      <span className="min-w-0">
                        <span dir="ltr" className="font-medium">
                          {r.number}
                        </span>{' '}
                        <span className="text-muted-foreground">
                          · {t(`disposition${r.disposition}`)} · {r.reason}
                        </span>
                      </span>
                      <Amount value={r.totalTtc} />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      {dialog === 'cancel' ? (
        <CancelSaleDialog sale={s} open onOpenChange={(o) => !o && setDialog(null)} />
      ) : null}
      {paymentId ? (
        <PaymentDetailDialog id={paymentId} open onOpenChange={(o) => !o && setPaymentId(null)} />
      ) : null}
      {dialog === 'return' ? (
        <ReturnDialog sale={s} open onOpenChange={(o) => !o && setDialog(null)} />
      ) : null}
    </>
  );
}
