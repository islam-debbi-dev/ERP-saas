'use client';

import { Laptop, LogOut } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Role, type TenantSessionDto } from '@erp/shared';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/lib/auth';
import { useErrorMessage } from '@/lib/use-error-message';
import { useRevokeSession, useSessions } from '@/lib/users';

/** "Chrome · macOS" from a user agent; enough to recognise a device. */
function deviceOf(s: TenantSessionDto): string {
  if (s.deviceName) return s.deviceName;
  const ua = s.userAgent ?? '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : null;
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS/.test(ua)
          ? 'macOS'
          : null;
  return [browser, os].filter(Boolean).join(' · ') || '—';
}

/** Paramètres > Sessions: the owner sees every device of the company and can close one. */
export function SessionsPage() {
  const t = useTranslations('sessions');
  const tr = useTranslations('roles');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const { state } = useAuth();
  const owner = state.user?.role === Role.OWNER;
  const sessions = useSessions();
  const revoke = useRevokeSession();

  return (
    <>
      <PageHeader title={t('title')} description={owner ? t('subtitleOwner') : t('subtitle')} />
      {sessions.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(sessions.error)}
        </p>
      ) : !sessions.data ? (
        <Skeleton className="h-48 w-full" aria-busy />
      ) : sessions.data.length === 0 ? (
        <EmptyState icon={Laptop} title={t('empty')} />
      ) : (
        <div className="w-full overflow-x-auto rounded-lg border bg-card">
          <Table className="stack-table min-w-[44rem]">
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>{t('colUser')}</TableHead>
                <TableHead>{t('colDevice')}</TableHead>
                <TableHead>{t('colIp')}</TableHead>
                <TableHead>{t('colLastActivity')}</TableHead>
                <TableHead>{t('colSince')}</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.data.map((s) => (
                <TableRow key={s.id}>
                  <TableCell data-cell="main">
                    <span className="font-medium">{s.user.fullName}</span>
                    <span className="ms-2 text-xs text-muted-foreground">{tr(s.user.role)}</span>
                  </TableCell>
                  <TableCell data-label={t('colDevice')}>
                    {deviceOf(s)}
                    {s.current ? (
                      <Badge variant="outline" className="ms-2">
                        {t('current')}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell data-label={t('colIp')}>
                    <span dir="ltr" className="num text-sm">
                      {s.ip ?? '—'}
                    </span>
                  </TableCell>
                  <TableCell
                    data-label={t('colLastActivity')}
                    className="text-sm text-muted-foreground"
                  >
                    {format.relativeTime(new Date(s.lastUsedAt), new Date())}
                  </TableCell>
                  <TableCell data-label={t('colSince')} className="text-sm text-muted-foreground">
                    {format.dateTime(new Date(s.createdAt), {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </TableCell>
                  <TableCell data-cell="actions" className="text-end">
                    {s.current ? null : (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm" className="text-destructive">
                            <LogOut aria-hidden />
                            {t('revoke')}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              {t('revokeTitle', { name: s.user.fullName })}
                            </AlertDialogTitle>
                            <AlertDialogDescription>{t('revokeHelp')}</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() =>
                                revoke.mutate(s.id, {
                                  onSuccess: () => toast.success(t('revoked')),
                                  onError: (err) => toast.error(errorMessage(err)),
                                })
                              }
                            >
                              {t('revoke')}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
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
