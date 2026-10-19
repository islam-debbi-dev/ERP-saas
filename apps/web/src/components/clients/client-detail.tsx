'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowLeft, Banknote, FileText, Pencil, Scale, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { type ClientDto, type ClientStatementDto, formatDA, money } from '@erp/shared';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { PrintButton } from '@/components/shared/print-button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api-client';
import { usePriceLevels } from '@/lib/catalog';
import {
  clientKeys,
  plafondUsage,
  useCanManageCredit,
  useClient,
  useStatement,
} from '@/lib/clients';
import { todayInAlgiers } from '@/lib/purchases';
import { useErrorMessage } from '@/lib/use-error-message';
import { PaymentDialog } from '@/components/payments/payment-dialog';
import { UnpaidDocuments } from '@/components/payments/unpaid-documents';
import { useUnpaidDocuments } from '@/lib/payments';
import { BalanceAmount, PlafondBar } from './balance-amount';
import { AdjustmentDialog, OpeningBalanceDialog } from './client-dialogs';

export function ClientDetail({ clientId }: { clientId: string }) {
  const t = useTranslations('clients');
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const queryClient = useQueryClient();
  const canManage = useCanManageCredit();
  const client = useClient(clientId);
  // Fetched in parallel with the client; UnpaidDocuments reads the same cache.
  const unpaid = useUnpaidDocuments(clientId);
  const [dialog, setDialog] = useState<'opening' | 'adjust' | 'payment' | null>(null);

  const archive = useMutation({
    mutationFn: () => api.request<void>(`/clients/${clientId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clientKeys.all });
      toast.success(t('archived'));
      router.push('/clients');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (client.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{errorMessage(client.error)}</AlertDescription>
      </Alert>
    );
  }
  const c = client.data;
  const live = c !== undefined && c.archivedAt === null;

  return (
    <>
      <PageHeader
        title={c?.name ?? t('detailTitle')}
        description={c ? `${t('code')} ${c.code}` : undefined}
        actions={
          <>
            <Button asChild variant="ghost">
              <Link href="/clients">
                <ArrowLeft className="rtl-flip" aria-hidden />
                {t('back')}
              </Link>
            </Button>
            {live ? (
              <Button asChild variant="outline">
                <Link href={`/clients/${clientId}/modifier`}>
                  <Pencil aria-hidden />
                  {t('edit')}
                </Link>
              </Button>
            ) : null}
            {live && canManage && !c.hasOpening ? (
              <Button variant="outline" onClick={() => setDialog('opening')}>
                <Wallet aria-hidden />
                {t('opening')}
              </Button>
            ) : null}
            {live && canManage ? (
              <Button variant="outline" onClick={() => setDialog('adjust')}>
                <Scale aria-hidden />
                {t('adjust')}
              </Button>
            ) : null}
            {live ? (
              <Button onClick={() => setDialog('payment')}>
                <Banknote aria-hidden />
                {t('newPayment')}
              </Button>
            ) : null}
          </>
        }
      />

      {c?.archivedAt ? (
        <Alert role="status">
          <AlertDescription>{t('archivedBanner')}</AlertDescription>
        </Alert>
      ) : null}

      {/* Sections appear together once client and unpaid documents are loaded (no layout shift). */}
      {c && unpaid.data ? (
        <>
          <Summary client={c} />
          <UnpaidDocuments clientId={c.id} />
          <Info client={c} />
          <StatementSection clientId={clientId} />
        </>
      ) : (
        <div className="grid gap-4" aria-busy>
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {live && canManage ? (
        <div className="flex justify-end">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" className="text-muted-foreground">
                <Archive aria-hidden />
                {t('archive')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('archiveTitle')}</AlertDialogTitle>
                <AlertDialogDescription>{t('archiveBody')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('keep')}</AlertDialogCancel>
                <AlertDialogAction onClick={() => archive.mutate()}>
                  {t('archive')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : null}

      {c && dialog === 'opening' ? (
        <OpeningBalanceDialog client={c} open onOpenChange={(o) => !o && setDialog(null)} />
      ) : null}
      {c && dialog === 'payment' ? (
        <PaymentDialog client={c} open onOpenChange={(o) => !o && setDialog(null)} />
      ) : null}
      {c && dialog === 'adjust' ? (
        <AdjustmentDialog client={c} open onOpenChange={(o) => !o && setDialog(null)} />
      ) : null}
    </>
  );
}

function Summary({ client }: { client: ClientDto }) {
  const t = useTranslations('clients');
  const usage = plafondUsage(client);
  const remaining =
    client.creditLimit === null ? null : money(client.creditLimit).minus(client.balance);
  return (
    <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
      <Card className="py-4">
        <CardContent className="space-y-1">
          <p className="text-sm text-muted-foreground">{t('balance')}</p>
          <BalanceAmount
            value={client.balance}
            className="text-2xl font-semibold [&>span:first-child]:font-semibold"
          />
        </CardContent>
      </Card>
      <Card className="py-4">
        <CardContent className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">{t('creditLimit')}</p>
            {client.overLimit ? <Badge variant="destructive">{t('overLimit')}</Badge> : null}
          </div>
          {client.creditLimit === null || usage === null || remaining === null ? (
            <p className="text-lg font-medium text-muted-foreground">{t('noLimit')}</p>
          ) : (
            <>
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span dir="ltr" className="num text-lg font-semibold">
                  {formatDA(client.creditLimit)}
                </span>
                <span className="text-sm text-muted-foreground">{t('usage', { pct: usage })}</span>
              </p>
              <PlafondBar usage={usage} label={t('usage', { pct: usage })} />
              <p className="text-xs text-muted-foreground">
                {remaining.gte(0) ? t('remaining') : t('exceededBy')}{' '}
                <span dir="ltr" className="num">
                  {formatDA(remaining.abs())}
                </span>
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Info({ client }: { client: ClientDto }) {
  const t = useTranslations('clients');
  const levels = usePriceLevels();
  const level = levels.data?.find((l) => l.id === client.priceLevelId);
  const rows: { label: string; value: string | null; ltr?: boolean }[] = [
    { label: t('type'), value: t(`type${client.type}`) },
    { label: t('phone'), value: client.phone, ltr: true },
    { label: t('phone2'), value: client.phone2, ltr: true },
    { label: t('address'), value: client.address },
    { label: t('commune'), value: client.commune },
    { label: t('wilaya'), value: client.wilaya },
    { label: t('priceLevel'), value: level?.name ?? t('defaultPriceLevel') },
    { label: t('rc'), value: client.rc, ltr: true },
    { label: t('nif'), value: client.nif, ltr: true },
    { label: t('nis'), value: client.nis, ltr: true },
    { label: t('ai'), value: client.ai, ltr: true },
    { label: t('notes'), value: client.notes },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {t('infoSection')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows
            .filter((r) => r.value)
            .map((r) => (
              <div key={r.label} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{r.label}</dt>
                <dd className="break-words">
                  {r.ltr ? <span dir="ltr">{r.value}</span> : r.value}
                </dd>
              </div>
            ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function firstOfMonth(day: string): string {
  return `${day.slice(0, 8)}01`;
}

function StatementSection({ clientId }: { clientId: string }) {
  const t = useTranslations('clients');
  const errorMessage = useErrorMessage();
  const [range, setRange] = useState(() => {
    const today = todayInAlgiers();
    return { from: firstOfMonth(today), to: today };
  });
  const statement = useStatement(clientId, range.from, range.to);
  const badRange = range.from === '' || range.to === '' || range.from > range.to;

  return (
    <section aria-labelledby="statement-title" className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h2 id="statement-title" className="text-lg font-semibold">
            {t('statementTitle')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('statementHelp')}</p>
        </div>
        <div className="grid grid-cols-2 items-end gap-3 sm:flex">
          <div className="space-y-1">
            <Label htmlFor="st-from">{t('from')}</Label>
            <Input
              id="st-from"
              type="date"
              dir="ltr"
              value={range.from}
              max={range.to || undefined}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="st-to">{t('to')}</Label>
            <Input
              id="st-to"
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
              path={`/clients/${clientId}/statement/pdf?from=${range.from}&to=${range.to}`}
            />
          )}
        </div>
      </div>
      {badRange ? (
        <Alert role="status">
          <AlertDescription>{t('badRange')}</AlertDescription>
        </Alert>
      ) : statement.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(statement.error)}</AlertDescription>
        </Alert>
      ) : statement.data ? (
        <StatementTable statement={statement.data} />
      ) : (
        <Skeleton className="h-48 w-full" aria-busy />
      )}
    </section>
  );
}

function Signed({ value }: { value: string }) {
  return (
    <span dir="ltr" className="num whitespace-nowrap">
      {formatDA(value)}
    </span>
  );
}

function StatementTable({ statement }: { statement: ClientStatementDto }) {
  const t = useTranslations('clients');
  const tl = useTranslations('clientLedgerTypes');
  const format = useFormatter();
  const day = (iso: string) =>
    format.dateTime(new Date(`${iso}T12:00:00Z`), { dateStyle: 'medium' });

  return (
    <div className="w-full overflow-x-auto rounded-lg border bg-card">
      <Table className="min-w-[42rem]">
        <caption className="sr-only">{t('statementTitle')}</caption>
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            <TableHead>{t('colDate')}</TableHead>
            <TableHead>{t('colOperation')}</TableHead>
            <TableHead className="text-end">{t('colDebit')}</TableHead>
            <TableHead className="text-end">{t('colCredit')}</TableHead>
            <TableHead className="text-end">{t('colBalance')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow className="bg-muted/20 font-medium">
            <TableCell>{day(statement.from)}</TableCell>
            <TableCell colSpan={3}>{t('openingLine')}</TableCell>
            <TableCell className="text-end">
              <Signed value={statement.openingBalance} />
            </TableCell>
          </TableRow>
          {statement.entries.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="p-0">
                <EmptyState icon={FileText} title={t('noEntries')} />
              </TableCell>
            </TableRow>
          ) : (
            statement.entries.map((e) => {
              const amount = money(e.amount);
              return (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap">
                    {format.dateTime(new Date(e.createdAt), {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <Badge variant="secondary" className="font-normal">
                        {tl(e.type)}
                      </Badge>
                      {e.label ? <p className="text-xs text-muted-foreground">{e.label}</p> : null}
                      {e.reason && e.reason !== e.label ? (
                        <p className="text-xs text-muted-foreground">{e.reason}</p>
                      ) : null}
                      {e.createdBy ? (
                        <p className="text-xs text-muted-foreground">{e.createdBy.fullName}</p>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-end">
                    {amount.gt(0) ? <Signed value={e.amount} /> : null}
                  </TableCell>
                  <TableCell className="text-end">
                    {amount.lt(0) ? <Signed value={amount.abs().toString()} /> : null}
                  </TableCell>
                  <TableCell className="text-end">
                    <Signed value={e.runningBalance} />
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
        <TableFooter>
          <TableRow className="font-semibold">
            <TableCell>{day(statement.to)}</TableCell>
            <TableCell>{t('closingLine')}</TableCell>
            <TableCell className="text-end">
              <Signed value={statement.totalDebit} />
            </TableCell>
            <TableCell className="text-end">
              <Signed value={statement.totalCredit} />
            </TableCell>
            <TableCell className="text-end">
              <Signed value={statement.closingBalance} />
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}
