'use client';

import { MoreHorizontal, Plus, Users } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Feature, formatPhone, Permission, Role, type UserDto } from '@erp/shared';
import { TeamTree } from '@/components/sales-force/team-tree';
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
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth, useFeature, usePermission } from '@/lib/auth';
import { UserVehiclesDialog } from '@/components/vehicles/user-vehicles-dialog';
import { useErrorMessage } from '@/lib/use-error-message';
import { useSetActive, useUsers } from '@/lib/users';
import {
  EditUserDialog,
  InviteDialog,
  PermissionsDialog,
  ResetPasswordDialog,
  WarehouseAccessDialog,
} from './user-dialogs';

type Open =
  | { kind: 'invite' }
  | {
      kind: 'edit' | 'permissions' | 'access' | 'reset' | 'deactivate' | 'vehicles';
      user: UserDto;
    }
  | null;

/**
 * Paramètres > Utilisateurs. Managers see the list; the owner, or anyone granted
 * USERS_MANAGE (phase 24), changes it. A non-owner never acts on an owner (the API refuses).
 */
export function UsersPage() {
  const t = useTranslations('users');
  const tr = useTranslations('roles');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const { state } = useAuth();
  const me = state.user;
  const owner = me?.role === Role.OWNER;
  const canManage = usePermission(Permission.USERS_MANAGE);
  const salesForce = useFeature(Feature.SALES_FORCE);
  const multiUnit = useFeature(Feature.MULTI_UNIT);
  const warehousesOn = useFeature(Feature.WAREHOUSES);
  const tu = useTranslations('multiUnit');
  const users = useUsers();
  const setActive = useSetActive();
  const [open, setOpen] = useState<Open>(null);
  const close = (o: boolean) => !o && setOpen(null);

  const toggleActive = (u: UserDto, active: boolean) =>
    setActive.mutate(
      { id: u.id, active },
      {
        onSuccess: () => toast.success(active ? t('reactivated') : t('deactivated')),
        onError: (err) => toast.error(errorMessage(err)),
      },
    );

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          canManage ? (
            <Button onClick={() => setOpen({ kind: 'invite' })}>
              <Plus aria-hidden />
              {t('invite')}
            </Button>
          ) : undefined
        }
      />
      {users.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(users.error)}
        </p>
      ) : !users.data ? (
        <Skeleton className="h-48 w-full" aria-busy />
      ) : users.data.length === 0 ? (
        <EmptyState icon={Users} title={t('empty')} />
      ) : (
        <div className="w-full overflow-x-auto rounded-lg border bg-card">
          <Table className="stack-table min-w-[44rem]">
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>{t('colName')}</TableHead>
                <TableHead>{t('colLogin')}</TableHead>
                <TableHead>{t('colRole')}</TableHead>
                {salesForce ? <TableHead>{t('colManager')}</TableHead> : null}
                <TableHead>{t('colStatus')}</TableHead>
                <TableHead>{t('colLastActivity')}</TableHead>
                {canManage ? <TableHead className="w-10" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.data.map((u) => (
                <TableRow key={u.id} className={u.active ? undefined : 'opacity-60'}>
                  <TableCell data-cell="main" className="font-medium">
                    {u.fullName}
                    {u.id === me?.id ? (
                      <span className="ms-2 text-xs text-muted-foreground">({t('you')})</span>
                    ) : null}
                  </TableCell>
                  <TableCell data-label={t('colLogin')}>
                    <div className="flex flex-col text-sm" dir="ltr">
                      {u.phone ? (
                        <span className="text-start rtl:text-end">{formatPhone(u.phone)}</span>
                      ) : null}
                      {u.email ? (
                        <span className="text-start text-muted-foreground rtl:text-end">
                          {u.email}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell data-label={t('colRole')}>
                    {tr(u.role)}
                    {u.grants.length + u.revokes.length > 0 ? (
                      <span className="ms-1 text-xs text-muted-foreground">{t('customized')}</span>
                    ) : null}
                  </TableCell>
                  {salesForce ? (
                    <TableCell data-label={t('colManager')}>{u.managerName ?? '—'}</TableCell>
                  ) : null}
                  <TableCell data-label={t('colStatus')}>
                    <div className="flex flex-wrap gap-1">
                      {!u.active ? (
                        <Badge variant="secondary">{t('statusInactive')}</Badge>
                      ) : u.lockedUntil ? (
                        <Badge variant="destructive">{t('statusLocked')}</Badge>
                      ) : u.invitationPending ? (
                        <Badge variant="outline">{t('statusInvited')}</Badge>
                      ) : u.mustChangePassword ? (
                        <Badge variant="outline">{t('statusTempPassword')}</Badge>
                      ) : (
                        <Badge variant="outline" className="border-emerald-500/50">
                          {t('statusActive')}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell
                    data-label={t('colLastActivity')}
                    className="text-sm text-muted-foreground"
                  >
                    {u.lastActivityAt
                      ? format.relativeTime(new Date(u.lastActivityAt), new Date())
                      : '—'}
                  </TableCell>
                  {canManage && !owner && u.role === Role.OWNER ? (
                    <TableCell data-cell="actions" />
                  ) : canManage ? (
                    <TableCell data-cell="actions">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t('actions', { name: u.fullName })}
                          >
                            <MoreHorizontal aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setOpen({ kind: 'edit', user: u })}>
                            {t('edit')}
                          </DropdownMenuItem>
                          {u.role !== Role.OWNER ? (
                            <DropdownMenuItem
                              onSelect={() => setOpen({ kind: 'permissions', user: u })}
                            >
                              {t('permissions')}
                            </DropdownMenuItem>
                          ) : null}
                          {warehousesOn ? (
                            <DropdownMenuItem
                              onSelect={() => setOpen({ kind: 'vehicles', user: u })}
                            >
                              {t('vehiclesDriven')}
                            </DropdownMenuItem>
                          ) : null}
                          {multiUnit && u.role !== Role.OWNER ? (
                            <DropdownMenuItem onSelect={() => setOpen({ kind: 'access', user: u })}>
                              {tu('menuAccess')}
                            </DropdownMenuItem>
                          ) : null}
                          {u.active && (u.role !== Role.OWNER || u.id === me?.id) ? (
                            <DropdownMenuItem onSelect={() => setOpen({ kind: 'reset', user: u })}>
                              {t('resetPassword')}
                            </DropdownMenuItem>
                          ) : null}
                          {u.id !== me?.id && u.role !== Role.OWNER ? (
                            <>
                              <DropdownMenuSeparator />
                              {u.active ? (
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onSelect={() => setOpen({ kind: 'deactivate', user: u })}
                                >
                                  {t('deactivate')}
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onSelect={() => toggleActive(u, true)}>
                                  {t('reactivate')}
                                </DropdownMenuItem>
                              )}
                            </>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {salesForce && users.data && users.data.length > 0 ? <TeamTree /> : null}

      {open?.kind === 'invite' ? <InviteDialog open onOpenChange={close} /> : null}
      {open?.kind === 'edit' ? <EditUserDialog user={open.user} open onOpenChange={close} /> : null}
      {open?.kind === 'permissions' ? (
        <PermissionsDialog user={open.user} open onOpenChange={close} />
      ) : null}
      {open?.kind === 'access' ? (
        <WarehouseAccessDialog user={open.user} open onOpenChange={close} />
      ) : null}
      <UserVehiclesDialog
        user={open?.kind === 'vehicles' ? open.user : null}
        onOpenChange={close}
      />
      {open?.kind === 'reset' ? (
        <ResetPasswordDialog user={open.user} open onOpenChange={close} />
      ) : null}
      {open?.kind === 'deactivate' ? (
        <AlertDialog open onOpenChange={close}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t('deactivateTitle', { name: open.user.fullName })}
              </AlertDialogTitle>
              <AlertDialogDescription>{t('deactivateHelp')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={() => toggleActive(open.user, false)}>
                {t('deactivate')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </>
  );
}
