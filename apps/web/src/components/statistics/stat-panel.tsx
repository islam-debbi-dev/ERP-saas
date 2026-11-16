'use client';

import { ChartColumn, Download, Info, Loader2, Table2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
import { Permission } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermission } from '@/lib/auth';
import { cn } from '@/lib/utils';

// recharts only loads on this screen, after the page itself (docs/ui.md rule 10).
const loading = () => <Skeleton className="h-56 w-full" />;
export const RankBarChart = dynamic(() => import('./charts').then((m) => m.RankBarChart), {
  ssr: false,
  loading,
});
export const TimeAreaChart = dynamic(() => import('./charts').then((m) => m.TimeAreaChart), {
  ssr: false,
  loading,
});
export const DonutChart = dynamic(() => import('./charts').then((m) => m.DonutChart), {
  ssr: false,
  loading,
});
export type { ChartRow, ChartSeries, DonutSlice } from './charts';

/**
 * One block of the statistics: a title, its definition behind an info button (a tap, not
 * a hover), a "Tableau" toggle that shows the same numbers as a table, and the export.
 * `chart` is optional: a block that is only a table has no toggle.
 */
export function StatPanel({
  title,
  definition,
  chart,
  table,
  onExport,
  note,
  className,
}: {
  title: string;
  definition?: ReactNode;
  chart?: ReactNode;
  table: ReactNode;
  onExport?: () => Promise<void>;
  /** "Poids estimé", "poids inconnu (N lignes)"…: always visible, never in a tooltip. */
  note?: ReactNode;
  className?: string;
}) {
  const t = useTranslations('stats');
  const canExport = usePermission(Permission.EXPORT_DATA);
  const [asTable, setAsTable] = useState(!chart);
  const [info, setInfo] = useState(false);
  const [exporting, setExporting] = useState(false);
  const infoId = useId();
  const run = async () => {
    if (!onExport) return;
    setExporting(true);
    try {
      await onExport();
    } finally {
      setExporting(false);
    }
  };
  return (
    <Card className={cn('min-w-0 gap-3 py-4', className)}>
      <CardHeader className="flex flex-row flex-wrap items-center gap-1 px-4">
        <h2 className="me-auto min-w-0 text-base font-semibold">{title}</h2>
        {definition ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label={t('definition')}
            aria-expanded={info}
            aria-controls={infoId}
            onClick={() => setInfo((v) => !v)}
          >
            <Info aria-hidden />
          </Button>
        ) : null}
        {chart ? (
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11"
            aria-pressed={asTable}
            onClick={() => setAsTable((v) => !v)}
          >
            {asTable ? <ChartColumn aria-hidden /> : <Table2 aria-hidden />}
            {asTable ? t('showChart') : t('showTable')}
          </Button>
        ) : null}
        {onExport && canExport ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label={t('export')}
            disabled={exporting}
            onClick={() => void run()}
          >
            {exporting ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Download aria-hidden />
            )}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="min-w-0 space-y-3 px-4">
        {definition && info ? (
          <p id={infoId} className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            {definition}
          </p>
        ) : null}
        {note ? <div className="text-xs text-muted-foreground">{note}</div> : null}
        <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
          {asTable || !chart ? table : chart}
        </div>
      </CardContent>
    </Card>
  );
}

/** A table that scrolls inside its own box on a phone, first column sticky (docs/ui.md 2). */
export function StatTable({
  head,
  rows,
  foot,
  caption,
}: {
  head: ReactNode[];
  rows: { key: string; cells: ReactNode[] }[];
  foot?: ReactNode[];
  caption: string;
}) {
  return (
    <div className="max-w-full overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            {head.map((h, i) => (
              <th
                key={i}
                scope="col"
                className={cn(
                  'px-3 py-2 font-medium whitespace-nowrap',
                  i === 0 ? 'sticky start-0 bg-muted text-start' : 'text-end',
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t">
              {r.cells.map((c, i) =>
                i === 0 ? (
                  <th
                    key={i}
                    scope="row"
                    className="sticky start-0 max-w-40 truncate bg-card px-3 py-2 text-start font-medium"
                  >
                    {c}
                  </th>
                ) : (
                  <td key={i} className="num px-3 py-2 text-end whitespace-nowrap">
                    {c}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
        {foot ? (
          <tfoot className="border-t-2 font-semibold">
            <tr>
              {foot.map((c, i) =>
                i === 0 ? (
                  <th key={i} scope="row" className="sticky start-0 bg-card px-3 py-2 text-start">
                    {c}
                  </th>
                ) : (
                  <td key={i} className="num px-3 py-2 text-end whitespace-nowrap">
                    {c}
                  </td>
                ),
              )}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

/** A figure in a table cell or a tile: left-to-right inside Arabic, digits aligned. */
export function Num({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={cn('num whitespace-nowrap tabular-nums', className)}>
      {children}
    </bdi>
  );
}
