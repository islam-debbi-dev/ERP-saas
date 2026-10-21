'use client';

import { History, Loader2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import type { AuditLogDto } from '@erp/shared';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { useErrorMessage } from '@/lib/use-error-message';
import { type AuditFilters, useAuditFacets, useAuditLogs, useUsers } from '@/lib/users';
import { cn } from '@/lib/utils';

const EMPTY: AuditFilters = { userId: '', entity: '', action: '', from: '', to: '' };

/** Paramètres > Journal d'audit: read-only, for the owner and managers. */
export function AuditPage() {
  const t = useTranslations('audit');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const [filters, setFilters] = useState<AuditFilters>(EMPTY);
  const [openRow, setOpenRow] = useState<AuditLogDto | null>(null);
  const logs = useAuditLogs(filters);
  const facets = useAuditFacets();
  const users = useUsers();
  const items = useMemo(() => logs.data?.pages.flatMap((p) => p.items) ?? [], [logs.data]);
  const set = (patch: Partial<AuditFilters>) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="audit-user">{t('user')}</Label>
          <NativeSelect
            id="audit-user"
            className="w-48"
            value={filters.userId}
            onChange={(e) => set({ userId: e.target.value })}
          >
            <option value="">{t('all')}</option>
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-entity">{t('entity')}</Label>
          <NativeSelect
            id="audit-entity"
            className="w-44"
            value={filters.entity}
            onChange={(e) => set({ entity: e.target.value })}
          >
            <option value="">{t('all')}</option>
            {facets.data?.entities.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-action">{t('action')}</Label>
          <NativeSelect
            id="audit-action"
            className="w-56"
            value={filters.action}
            onChange={(e) => set({ action: e.target.value })}
          >
            <option value="">{t('all')}</option>
            {facets.data?.actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-from">{t('from')}</Label>
          <Input
            id="audit-from"
            type="date"
            dir="ltr"
            className="w-40"
            value={filters.from}
            onChange={(e) => set({ from: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-to">{t('to')}</Label>
          <Input
            id="audit-to"
            type="date"
            dir="ltr"
            className="w-40"
            value={filters.to}
            onChange={(e) => set({ to: e.target.value })}
          />
        </div>
        {filters !== EMPTY ? (
          <Button variant="ghost" onClick={() => setFilters(EMPTY)}>
            {t('reset')}
          </Button>
        ) : null}
      </div>

      {logs.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(logs.error)}
        </p>
      ) : logs.isPending ? (
        <Skeleton className="h-64 w-full" aria-busy />
      ) : items.length === 0 ? (
        <EmptyState icon={History} title={t('empty')} />
      ) : (
        <>
          <div className="w-full overflow-x-auto rounded-lg border bg-card">
            <Table className="min-w-[44rem]">
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>{t('colWhen')}</TableHead>
                  <TableHead>{t('colUser')}</TableHead>
                  <TableHead>{t('colAction')}</TableHead>
                  <TableHead>{t('colEntity')}</TableHead>
                  <TableHead>{t('colDevice')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((l) => (
                  <TableRow
                    key={l.id}
                    className="cursor-pointer"
                    onClick={() => setOpenRow(l)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setOpenRow(l);
                    }}
                  >
                    <TableCell className="whitespace-nowrap text-sm">
                      {format.dateTime(new Date(l.createdAt), {
                        dateStyle: 'short',
                        timeStyle: 'medium',
                      })}
                    </TableCell>
                    <TableCell>{l.user?.fullName ?? t('system')}</TableCell>
                    <TableCell>
                      <code dir="ltr" className="text-xs">
                        {l.action}
                      </code>
                    </TableCell>
                    <TableCell className="text-sm">{l.entity}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span>{l.deviceName ?? '—'}</span>
                        {l.ip ? (
                          <span dir="ltr" className="num text-xs">
                            {l.ip}
                          </span>
                        ) : null}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {logs.hasNextPage ? (
            <Button
              variant="outline"
              className="self-center"
              disabled={logs.isFetchingNextPage}
              onClick={() => void logs.fetchNextPage()}
            >
              {logs.isFetchingNextPage ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t('more')}
            </Button>
          ) : null}
        </>
      )}

      {openRow ? <AuditDetail row={openRow} onClose={() => setOpenRow(null)} /> : null}
    </>
  );
}

function show(v: unknown): string {
  if (v === undefined) return '';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/** Field by field: what the entry changed, highlighted. */
function AuditDetail({ row, onClose }: { row: AuditLogDto; onClose: () => void }) {
  const t = useTranslations('audit');
  const format = useFormatter();
  const before = (row.before ?? {}) as Record<string, unknown>;
  const after = (row.after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            <code dir="ltr">{row.action}</code>
          </DialogTitle>
          <DialogDescription>
            {row.user?.fullName ?? t('system')} ·{' '}
            {format.dateTime(new Date(row.createdAt), { dateStyle: 'medium', timeStyle: 'medium' })}
            {row.entityId ? (
              <>
                {' · '}
                {row.entity}{' '}
                <code dir="ltr" className="text-xs">
                  {row.entityId}
                </code>
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        {keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noDetails')}</p>
        ) : (
          <div className="max-h-[60vh] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('field')}</TableHead>
                  <TableHead>{t('before')}</TableHead>
                  <TableHead>{t('after')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((k) => {
                  const b = show(before[k]);
                  const a = show(after[k]);
                  const changed = k in before && k in after && b !== a;
                  return (
                    <TableRow key={k} className={cn(changed && 'bg-amber-500/10')}>
                      <TableCell className="align-top font-medium">
                        <code dir="ltr" className="text-xs">
                          {k}
                        </code>
                      </TableCell>
                      <TableCell className="align-top">
                        <code
                          dir="ltr"
                          className="whitespace-pre-wrap break-all text-xs text-muted-foreground"
                        >
                          {b}
                        </code>
                      </TableCell>
                      <TableCell className="align-top">
                        <code dir="ltr" className="whitespace-pre-wrap break-all text-xs">
                          {a}
                        </code>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
