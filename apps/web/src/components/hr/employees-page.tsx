'use client';

import { type ColumnDef, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { Plus, Upload, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { type EmployeeDto, Feature, Permission } from '@erp/shared';
import { Amount } from '@/components/shared/amount';
import { EmptyState } from '@/components/shared/empty-state';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable } from '@/components/table/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePermission } from '@/lib/auth';
import { useEmployeePages } from '@/lib/hr';
import { EmployeeDialog } from './employee-dialog';
import { HrTabs } from './hr-tabs';

export function EmployeesPage() {
  return (
    <FeatureGate feature={Feature.HR}>
      <Employees />
    </FeatureGate>
  );
}

function Employees() {
  const t = useTranslations('hr');
  const router = useRouter();
  const canManage = usePermission(Permission.HR_MANAGE);
  const canPay = usePermission(Permission.SALARY_VIEW);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const pages = useEmployeePages(search.trim());
  const items = useMemo(() => pages.data?.pages.flatMap((p) => p.items) ?? [], [pages.data]);

  const columns = useMemo<ColumnDef<EmployeeDto>[]>(
    () => [
      {
        id: 'name',
        meta: { card: 'title' },
        header: t('fullName'),
        cell: ({ row }) => <span className="font-medium">{row.original.fullName}</span>,
      },
      {
        id: 'position',
        meta: { card: 'subtitle' },
        header: t('position'),
        cell: ({ row }) => row.original.position ?? '',
      },
      {
        id: 'matricule',
        meta: { card: 'field' },
        header: t('matricule'),
        cell: ({ row }) => (
          <span dir="ltr" className="num">
            {row.original.matricule}
          </span>
        ),
      },
      {
        id: 'depot',
        meta: { card: 'field' },
        header: t('depot'),
        cell: ({ row }) => row.original.warehouse?.name ?? '',
      },
      {
        id: 'leave',
        meta: { card: 'field' },
        header: t('leaveBalance'),
        cell: ({ row }) => <span className="num">{row.original.leaveBalance}</span>,
      },
      ...(canPay
        ? [
            {
              id: 'advance',
              meta: { card: 'end' as const },
              header: t('advanceBalance'),
              cell: ({ row }: { row: { original: EmployeeDto } }) => (
                <Amount value={row.original.pay?.advanceBalance ?? '0'} />
              ),
            },
          ]
        : []),
      {
        id: 'declared',
        meta: { card: 'badge' },
        header: t('declared'),
        cell: ({ row }) =>
          row.original.declared ? (
            <Badge variant="secondary">{t('declaredYes')}</Badge>
          ) : (
            <Badge variant="outline">{t('declaredNo')}</Badge>
          ),
      },
    ],
    [t, canPay],
  );
  const table = useReactTable({ data: items, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <>
      <PageHeader
        title={t('employeesTitle')}
        description={t('employeesSubtitle')}
        actions={
          canManage ? (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              {t('newEmployee')}
            </Button>
          ) : undefined
        }
        more={[
          canManage &&
            canPay && { label: t('importEmployees'), icon: Upload, href: '/parametres/import' },
        ]}
      />
      <HrTabs />
      <div className="space-y-2 md:max-w-sm">
        <Label htmlFor="emp-search" className="sr-only">
          {t('search')}
        </Label>
        <Input
          id="emp-search"
          type="search"
          className="h-11 text-base"
          placeholder={t('search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <DataTable
        table={table}
        caption={t('employeesTitle')}
        isLoading={pages.isPending}
        onRowClick={(e) => router.push(`/rh/employes/${e.id}`)}
        emptyState={
          <EmptyState icon={Users} title={t('noEmployees')} description={t('noEmployeesHelp')} />
        }
      />
      {pages.hasNextPage ? (
        <Button
          variant="outline"
          className="min-h-11 self-center"
          disabled={pages.isFetchingNextPage}
          onClick={() => void pages.fetchNextPage()}
        >
          {t('loadMore')}
        </Button>
      ) : null}
      <EmployeeDialog
        open={creating}
        employee={null}
        onOpenChange={setCreating}
        onSaved={(e) => router.push(`/rh/employes/${e.id}`)}
      />
    </>
  );
}
