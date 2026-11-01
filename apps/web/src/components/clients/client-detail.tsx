'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArrowLeft,
  Banknote,
  FileText,
  Pencil,
  Scale,
  Share2,
  Wallet,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { type ClientDto, type ClientStatementDto, Feature, formatDA, money } from '@erp/shared';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { PrintButton } from '@/components/shared/print-button';
import { ShareLinkDialog } from '@/components/shared/share-link-dialog';
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
import { useFeature } from '@/lib/auth';
import { cn, isolateLtr } from '@/lib/utils';
import { useTenantSettings } from '@/lib/settings';
import { useErrorMessage } from '@/lib/use-error-message';
import { PaymentDialog } from '@/components/payments/payment-dialog';
import { UnpaidDocuments } from '@/components/payments/unpaid-documents';
import { useUnpaidDocuments } from '@/lib/payments';
import { ClientLocationCard } from '@/components/geo/client-location-card';
import { ClientPackagingCard } from '@/components/distribution/client-packaging-card';
import { BalanceAmount, PlafondBar } from './balance-amount';
import { AdjustmentDialog, OpeningBalanceDialog } from './client-dialogs';
import { Amount } from '@/components/shared/amount';
import { useIsMobile } from '@/hooks/use-mobile';

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
        // While loading, a blank line and a disabled button keep their room: no layout shift.
        description={c ? `${t('code')} ${c.code}` : '\u00a0'}
        more={[
          { label: t('back'), icon: ArrowLeft, flipIcon: true, href: '/clients' },
          live && { label: t('edit'), icon: Pencil, href: `/clients/${clientId}/modifier` },
          live &&
            canManage &&
            !c.hasOpening && {
              label: t('opening'),
              icon: Wallet,
              onSelect: () => setDialog('opening'),
            },
          live &&
            canManage && { label: t('adjust'), icon: Scale, onSelect: () => setDialog('adjust') },
        ]}
        actions={
          live || !c ? (
            <Button disabled={!live} onClick={() => setDialog('payment')}>
              <Banknote aria-hidden />
              {t('newPayment')}
            </Button>
          ) : null
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
          <ClientLocationCard client={c} />
          <ClientPackagingCard client={c} />
          <StatementSection client={c} />
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
                  <Amount value={client.creditLimit} />
                </span>
                <span className="text-sm text-muted-foreground">{t('usage', { pct: usage })}</span>
              </p>
              <PlafondBar usage={usage} label={t('usage', { pct: usage })} />
              <p className="text-xs text-muted-foreground">
                {remaining.gte(0) ? t('remaining') : t('exceededBy')}{' '}
                <span dir="ltr" className="num">
                  <Amount value={remaining.abs()} />
                </span>
              </p>
            </>
          )}
        </CardContent>
      </Card>
      {client.debtByWarehouse && client.debtByWarehouse.length > 1 ? (
        <DebtByWarehouse parts={client.debtByWarehouse} />
      ) : null}
    </div>
  );
}

/** One client account split by dépôt (phase 24); the parts add up to the balance. */
function DebtByWarehouse({ parts }: { parts: NonNullable<ClientDto['debtByWarehouse']> }) {
  const t = useTranslations('multiUnit');
  return (
    <Card className="py-4 sm:col-span-2">
      <CardContent className="space-y-2">
        <p className="text-sm text-muted-foreground">{t('debtByWarehouse')}</p>
        <ul className="divide-y">
          {parts.map((p) => (
            <li
              key={p.warehouse?.id ?? 'none'}
              className="flex items-center justify-between gap-3 py-2"
            >
              <span className="min-w-0 truncate" title={p.warehouse?.name}>
                {p.warehouse?.name ?? '—'}
              </span>
              <BalanceAmount value={p.balance} className="shrink-0" />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
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
    // Sales force (phase 14): empty rows are not shown, so nothing appears without it.
    { label: t('sector'), value: client.sector?.name ?? null },
    { label: t('assignedSeller'), value: client.assignedSeller?.fullName ?? null },
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

function StatementSection({ client }: { client: ClientDto }) {
  const clientId = client.id;
  const t = useTranslations('clients');
  const ts = useTranslations('share');
  const errorMessage = useErrorMessage();
  const settings = useTenantSettings();
  const [sharing, setSharing] = useState(false);
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
            <>
              <PrintButton
                path={`/clients/${clientId}/statement/pdf?from=${range.from}&to=${range.to}`}
              />
              <Button type="button" variant="outline" onClick={() => setSharing(true)}>
                <Share2 aria-hidden />
                {ts('button')}
              </Button>
            </>
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
      {badRange || !sharing ? null : (
        <ShareLinkDialog
          open
          onOpenChange={setSharing}
          input={{ docType: 'RELEVE', docId: clientId, from: range.from, to: range.to }}
          phone={client.phone}
          message={(url) =>
            ts('statementMessage', {
              name: client.name,
              company: settings.data?.raisonSociale ?? '',
              balance: isolateLtr(formatDA(client.balance)),
              url,
            })
          }
        />
      )}
    </section>
  );
}

function Signed({ value }: { value: string }) {
  return <Amount value={value} />;
}

function StatementTable({ statement }: { statement: ClientStatementDto }) {
  const t = useTranslations('clients');
  const tl = useTranslations('clientLedgerTypes');
  const tu = useTranslations('multiUnit');
  const multiUnit = useFeature(Feature.MULTI_UNIT);
  const format = useFormatter();
  const day = (iso: string) =>
    format.dateTime(new Date(`${iso}T12:00:00Z`), { dateStyle: 'medium' });
  const isMobile = useIsMobile();

  if (isMobile) {
    // Phone: one card per entry, the movement and the balance after it on the end side.
    const edge = (label: string, date: string, balance: string) => (
      <li className="flex items-baseline justify-between gap-3 bg-muted/30 p-3 text-sm font-medium">
        <span className="min-w-0">
          <span className="block">{label}</span>
          <span className="text-xs font-normal text-muted-foreground">{day(date)}</span>
        </span>
        <Signed value={balance} />
      </li>
    );
    return (
      <ul aria-label={t('statementTitle')} className="divide-y rounded-lg border bg-card">
        {edge(t('openingLine'), statement.from, statement.openingBalance)}
        {statement.entries.length === 0 ? (
          <li>
            <EmptyState icon={FileText} title={t('noEntries')} />
          </li>
        ) : (
          statement.entries.map((e) => {
            const amount = money(e.amount);
            return (
              <li key={e.id} className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0 space-y-1">
                  <Badge variant="secondary" className="font-normal">
                    {tl(e.type)}
                  </Badge>
                  {e.label ? <p className="truncate text-sm">{e.label}</p> : null}
                  {e.reason && e.reason !== e.label ? (
                    <p className="text-xs text-muted-foreground">{e.reason}</p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    {format.dateTime(new Date(e.createdAt), {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                    {e.createdBy ? ` · ${e.createdBy.fullName}` : ''}
                  </p>
                  {multiUnit && e.warehouse ? (
                    <p className="truncate text-xs text-muted-foreground">
                      {e.reduced ? tu('reducedLine', { name: e.warehouse.name }) : e.warehouse.name}
                    </p>
                  ) : null}
                </div>
                <div className="shrink-0 space-y-1 text-end">
                  <p
                    className={cn(
                      'font-medium',
                      amount.gt(0) ? 'text-destructive' : 'text-primary',
                    )}
                  >
                    <span className="sr-only">
                      {amount.gt(0) ? t('colDebit') : t('colCredit')}{' '}
                    </span>
                    <span aria-hidden>{amount.gt(0) ? '+' : '−'}</span>
                    <Amount value={amount.abs()} />
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('colBalance')} <Signed value={e.runningBalance} />
                  </p>
                </div>
              </li>
            );
          })
        )}
        {edge(t('closingLine'), statement.to, statement.closingBalance)}
      </ul>
    );
  }

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
                      {multiUnit && e.warehouse ? (
                        <p className="text-xs text-muted-foreground">
                          {e.reduced
                            ? tu('reducedLine', { name: e.warehouse.name })
                            : e.warehouse.name}
                        </p>
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
