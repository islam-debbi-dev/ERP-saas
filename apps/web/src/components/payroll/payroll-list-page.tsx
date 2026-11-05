'use client';

import { Banknote, ChevronLeft, Percent, Plus, Settings2, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { algiersDay, Feature, Permission, previousMonth } from '@erp/shared';
import { HrTabs } from '@/components/hr/hr-tabs';
import { Amount } from '@/components/shared/amount';
import { EmptyState } from '@/components/shared/empty-state';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import { Skeleton } from '@/components/ui/skeleton';
import { useFeature, usePermission } from '@/lib/auth';
import { monthName, useCreatePayrollRun, usePayrollRates, usePayrollRuns } from '@/lib/payroll';
import { useWarehouses } from '@/lib/stock';
import { useErrorMessage } from '@/lib/use-error-message';

export function PayrollListPage() {
  return (
    <FeatureGate feature={Feature.PAYROLL}>
      <List />
    </FeatureGate>
  );
}

function List() {
  const t = useTranslations('payroll');
  const locale = useLocale();
  const canManage = usePermission(Permission.PAYROLL_MANAGE);
  const canSee = usePermission(Permission.SALARY_VIEW);
  const canRates = usePermission(Permission.PAYROLL_RATES_MANAGE);
  const runs = usePayrollRuns();
  const newOfficial = usePayrollRates(canSee && canRates).data?.newOfficial;
  const [creating, setCreating] = useState(false);
  const items = useMemo(() => runs.data?.pages.flatMap((p) => p.items) ?? [], [runs.data]);

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          canManage ? (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              {t('newRun')}
            </Button>
          ) : undefined
        }
        more={[
          canSee && { label: t('settingsTitle'), icon: Settings2, href: '/rh/paie/reglages' },
          canSee && { label: t('ratesLink'), icon: Percent, href: '/rh/paie/taux' },
        ]}
      />
      <HrTabs />
      <p className="text-sm text-muted-foreground">{t('ratesResponsibility')}</p>
      {newOfficial ? (
        <Alert>
          <TriangleAlert aria-hidden />
          <AlertTitle>{t('ratesNewOfficial')}</AlertTitle>
          <AlertDescription>
            {t('ratesNewOfficialHelp', { date: newOfficial.effectiveFrom })}{' '}
            <Link href="/rh/paie/taux" className="inline-flex min-h-11 items-center underline">
              {t('ratesSee')}
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}
      {runs.isPending ? <Skeleton className="h-40 w-full" /> : null}
      {!runs.isPending && items.length === 0 ? (
        <EmptyState icon={Banknote} title={t('noRuns')} description={t('noRunsHelp')} />
      ) : null}
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {items.map((r) => (
          <li key={r.id}>
            <Link
              href={`/rh/paie/${r.id}`}
              className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Card className="gap-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-semibold">
                    {monthName(r.month, locale)}
                  </span>
                  <Badge variant={r.status === 'APPROVED' ? 'secondary' : 'outline'}>
                    {t(`status_${r.status}`)}
                  </Badge>
                </div>
                <p className="truncate text-sm text-muted-foreground">
                  {r.warehouse?.name ?? t('wholeCompany')}
                  {r.number ? (
                    <>
                      {', '}
                      <bdi dir="ltr" className="num">
                        {r.number}
                      </bdi>
                    </>
                  ) : null}
                </p>
                <div className="flex items-end justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">
                      {t('employeeCount', { count: r.employeeCount })}
                    </p>
                    <Amount value={r.totals.netToPay} className="text-lg font-semibold" />
                  </div>
                  <ChevronLeft
                    className="size-5 shrink-0 text-muted-foreground ltr:rotate-180"
                    aria-hidden
                  />
                </div>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
      {runs.hasNextPage ? (
        <Button
          variant="outline"
          className="min-h-11 self-center"
          disabled={runs.isFetchingNextPage}
          onClick={() => void runs.fetchNextPage()}
        >
          {t('loadMore')}
        </Button>
      ) : null}
      <NewRunDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

function NewRunDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('payroll');
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const create = useCreatePayrollRun();
  const multiUnit = useFeature(Feature.MULTI_UNIT);
  const warehouses = useWarehouses();
  const today = algiersDay().slice(0, 7);
  const [month, setMonth] = useState(previousMonth(today));
  const [warehouseId, setWarehouseId] = useState('');
  const depots = (warehouses.data ?? []).filter((w) => w.type !== 'VEHICLE');

  const submit = () =>
    create.mutate(
      { month, warehouseId: warehouseId || null },
      {
        onSuccess: (run) => {
          onOpenChange(false);
          router.push(`/rh/paie/${run.id}`);
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="md:max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('newRun')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{t('newRunHelp')}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="run-month">{t('month')}</Label>
            <Input
              id="run-month"
              type="month"
              className="h-11 text-base"
              max={today}
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
          {multiUnit ? (
            <div className="space-y-2">
              <Label htmlFor="run-depot">{t('depot')}</Label>
              <NativeSelect
                id="run-depot"
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
              >
                <option value="">{t('wholeCompany')}</option>
                {depots.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
        </div>
        <ResponsiveDialogFooter>
          <Button className="min-h-11" disabled={create.isPending || !month} onClick={submit}>
            {t('computeRun')}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
