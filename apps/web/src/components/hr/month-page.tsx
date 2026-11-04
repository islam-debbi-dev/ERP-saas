'use client';

import { CalendarRange, Download, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { algiersDay, Feature, type MonthCounts, Permission } from '@erp/shared';
import { EmptyState } from '@/components/shared/empty-state';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermission } from '@/lib/auth';
import { downloadMonth, useAttendanceMonth } from '@/lib/hr';
import { useErrorMessage } from '@/lib/use-error-message';
import { useWarehouseFilter } from '@/lib/warehouse-scope';
import { DayStatusCell, DayStatusLegend } from './day-status';
import { HrTabs } from './hr-tabs';

export function MonthPage() {
  return (
    <FeatureGate feature={Feature.HR}>
      <Month />
    </FeatureGate>
  );
}

export function CountsList({ counts }: { counts: MonthCounts }) {
  const t = useTranslations('hr');
  const items: [string, string | number][] = [
    [t('countPresent'), counts.present],
    [t('countJustified'), counts.absentJustified],
    [t('countUnjustified'), counts.absentUnjustified],
    [t('countSick'), counts.sick],
    [t('countLeave'), counts.leavePaid + counts.leaveUnpaid],
    [t('countLate'), counts.lateMinutes],
    [t('countOvertime'), counts.overtimeHours],
    [t('countUnmarked'), counts.unmarked],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-2">
          <dt className="truncate text-muted-foreground">{label}</dt>
          <dd className="num">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The month: a grid at the office, one card per employee on a phone. */
function Month() {
  const t = useTranslations('hr');
  const errorMessage = useErrorMessage();
  const [month, setMonth] = useState(algiersDay().slice(0, 7));
  const canExport = usePermission(Permission.EXPORT_DATA);
  const warehouseId = useWarehouseFilter();
  const [exporting, setExporting] = useState(false);
  const data = useAttendanceMonth(month);
  const d = data.data;

  const download = () => {
    setExporting(true);
    downloadMonth(month, warehouseId)
      .catch((err: unknown) => toast.error(errorMessage(err)))
      .finally(() => setExporting(false));
  };

  return (
    <>
      <PageHeader
        title={t('monthTitle')}
        description={t('monthSubtitle')}
        actions={
          canExport ? (
            <Button variant="outline" disabled={exporting} onClick={download}>
              {exporting ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Download aria-hidden />
              )}
              {t('export')}
            </Button>
          ) : undefined
        }
      />
      <HrTabs />
      <div className="space-y-2 md:max-w-52">
        <Label htmlFor="month-picker">{t('month')}</Label>
        <Input
          id="month-picker"
          type="month"
          className="h-11 text-base"
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
        />
      </div>
      <DayStatusLegend />

      {data.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : data.isError ? (
        <EmptyState icon={CalendarRange} title={errorMessage(data.error)} />
      ) : d?.countsOnly ? (
        <Card className="p-4">
          <p className="mb-3 text-sm text-muted-foreground">{t('countsOnly')}</p>
          <CountsList counts={d.totals} />
        </Card>
      ) : !d || d.rows.length === 0 ? (
        <EmptyState icon={CalendarRange} title={t('noEmployees')} />
      ) : (
        <>
          <ul className="space-y-2 md:hidden">
            {d.rows.map((r) => (
              <li key={r.employee.id}>
                <Card className="gap-3 p-3">
                  <p className="truncate font-medium">{r.employee.fullName}</p>
                  <CountsList counts={r.counts} />
                  <div className="flex flex-wrap gap-1">
                    {r.days.map((day) => (
                      <DayStatusCell key={day.date} status={day.status} date={day.date} />
                    ))}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded-md border md:block">
            <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
              <caption className="sr-only">{t('monthTitle')}</caption>
              <thead>
                <tr>
                  <th scope="col" className="sticky start-0 z-10 bg-background p-2 text-start">
                    {t('employee')}
                  </th>
                  {d.days.map((day) => (
                    <th key={day} scope="col" className="num p-1 text-center text-xs font-medium">
                      {Number(day.slice(8, 10))}
                    </th>
                  ))}
                  <th scope="col" className="p-2 text-end">
                    {t('countPresent')}
                  </th>
                  <th scope="col" className="p-2 text-end">
                    {t('countAbsences')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.employee.id}>
                    <th
                      scope="row"
                      className="sticky start-0 z-10 max-w-48 truncate border-t bg-background p-2 text-start font-medium"
                    >
                      {r.employee.fullName}
                    </th>
                    {r.days.map((day) => (
                      <td key={day.date} className="border-t p-0.5 text-center">
                        <DayStatusCell status={day.status} date={day.date} />
                      </td>
                    ))}
                    <td className="num border-t p-2 text-end">{r.counts.present}</td>
                    <td className="num border-t p-2 text-end">
                      {r.counts.absentJustified + r.counts.absentUnjustified + r.counts.sick}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
