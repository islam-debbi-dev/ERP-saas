'use client';

import { Loader2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo } from 'react';
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
import { useImportPages } from '@/lib/imports';

/** Every import of the tenant (previews, confirmed and failed), newest first. */
export function ImportHistory() {
  const t = useTranslations('imports');
  const format = useFormatter();
  const pages = useImportPages();
  const items = useMemo(() => pages.data?.pages.flatMap((p) => p.items) ?? [], [pages.data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('history')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {pages.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('historyEmpty')}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('date')}</TableHead>
                  <TableHead>{t('type')}</TableHead>
                  <TableHead>{t('file')}</TableHead>
                  <TableHead>{t('status')}</TableHead>
                  <TableHead>{t('rows')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="whitespace-nowrap">
                      {format.dateTime(new Date(job.createdAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </TableCell>
                    <TableCell>{t(`types.${job.type}`)}</TableCell>
                    <TableCell className="max-w-56 truncate" dir="auto">
                      {job.fileName}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          job.status === 'COMPLETED'
                            ? 'default'
                            : job.status === 'FAILED'
                              ? 'destructive'
                              : 'outline'
                        }
                      >
                        {t(`statuses.${job.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="num whitespace-nowrap tabular-nums">
                      {job.status === 'COMPLETED'
                        ? t('historyDone', {
                            created: job.createdRows,
                            updated: job.updatedRows,
                            opening: job.openingRows,
                          })
                        : t('historyRows', { total: job.totalRows, errors: job.errorRows })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {pages.hasNextPage ? (
          <Button
            variant="outline"
            className="w-fit"
            disabled={pages.isFetchingNextPage}
            onClick={() => void pages.fetchNextPage()}
          >
            {pages.isFetchingNextPage ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t('more')}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
