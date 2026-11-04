'use client';

import { Building2, Percent, Search } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useDeferredValue, useState } from 'react';
import { SubscriptionStatus } from '@erp/shared';
import { SubscriptionStatusBadge } from '@/components/billing/subscription-status-badge';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAdminAuth, useAdminTenants } from '@/lib/admin';
import { useErrorMessage } from '@/lib/use-error-message';

const STATUSES = Object.values(SubscriptionStatus);

/** Every company on the platform: plan, status, renewal and how much it uses the app. */
export function AdminTenantsPage() {
  const t = useTranslations('admin');
  const tb = useTranslations('billing');
  const tf = useTranslations('features');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const { state } = useAdminAuth();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<SubscriptionStatus | ''>('');
  const deferredQ = useDeferredValue(q.trim());
  const tenants = useAdminTenants(
    { q: deferredQ || undefined, status: status || undefined },
    state.status === 'authenticated',
  );
  const n = (v: number) => format.number(v);

  return (
    <>
      <PageHeader
        title={t('tenants')}
        more={[{ label: t('rateSets'), icon: Percent, href: '/admin/taux-paie' }]}
        description={tenants.data ? t('tenantsCount', { count: tenants.data.length }) : undefined}
      />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="relative">
          <Label htmlFor="admin-search" className="sr-only">
            {t('search')}
          </Label>
          <Search
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id="admin-search"
            type="search"
            className="ps-9"
            placeholder={t('search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="admin-status" className="sr-only">
            {t('status')}
          </Label>
          <NativeSelect
            id="admin-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as SubscriptionStatus | '')}
          >
            <option value="">{t('allStatuses')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {tb(`status${s}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {tenants.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(tenants.error)}
        </p>
      ) : !tenants.data ? (
        <Skeleton className="h-64 w-full" aria-busy />
      ) : tenants.data.length === 0 ? (
        <div className="rounded-lg border bg-card">
          <EmptyState icon={Building2} title={t('empty')} />
        </div>
      ) : (
        <div className="w-full overflow-x-auto rounded-lg border bg-card">
          <Table className="stack-table">
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>{t('colCompany')}</TableHead>
                <TableHead>{t('colStatus')}</TableHead>
                <TableHead>{t('colEnds')}</TableHead>
                <TableHead className="text-end">{t('colUsers')}</TableHead>
                <TableHead className="text-end">{t('colProducts')}</TableHead>
                <TableHead className="text-end">{t('colDocs')}</TableHead>
                <TableHead>{t('colActivity')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell data-cell="main">
                    <Link
                      href={`/admin/societes/${r.id}`}
                      className="block min-w-0 font-medium underline-offset-4 hover:underline"
                    >
                      <span className="block truncate">{r.name}</span>
                      <span className="block text-xs font-normal text-muted-foreground">
                        {r.planName} · {tf(`edition${r.edition}`)}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell data-label={t('colStatus')}>
                    <SubscriptionStatusBadge status={r.status} isFree={r.isFree} />
                  </TableCell>
                  <TableCell data-label={t('colEnds')} className="text-sm">
                    {r.isFree
                      ? '—'
                      : format.dateTime(new Date(r.currentPeriodEnd), { dateStyle: 'medium' })}
                  </TableCell>
                  <TableCell data-label={t('colUsers')} className="num text-end">
                    {n(r.usage.users)}
                  </TableCell>
                  <TableCell data-label={t('colProducts')} className="num text-end">
                    {n(r.usage.products)}
                  </TableCell>
                  <TableCell data-label={t('colDocs')} className="num text-end">
                    {n(r.usage.documentsThisMonth)}
                  </TableCell>
                  <TableCell
                    data-label={t('colActivity')}
                    className="text-sm text-muted-foreground"
                  >
                    {r.lastActivityAt
                      ? format.relativeTime(new Date(r.lastActivityAt), new Date())
                      : t('never')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
