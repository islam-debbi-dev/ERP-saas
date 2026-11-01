'use client';

import {
  ArrowLeft,
  ArrowLeftRight,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Truck,
  Warehouse,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Feature, Permission, type WarehouseDto, WarehouseType } from '@erp/shared';
import { EmptyState } from '@/components/shared/empty-state';
import { FeatureGate } from '@/components/shared/feature-gate';
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
import { Switch } from '@/components/ui/switch';
import { useFeature, usePermission } from '@/lib/auth';
import { useSellers } from '@/lib/sales-force';
import { useArchiveWarehouse, useSaveWarehouse, useWarehouses } from '@/lib/stock';
import { useErrorMessage } from '@/lib/use-error-message';

interface Editing {
  id: string | null;
  name: string;
  type: 'SECONDARY' | 'VEHICLE';
  isDefault: boolean;
  assignedUserId: string;
  active: boolean;
  /** The dépôt a truck belongs to (phase 24, MULTI_UNIT); '' = unchanged / MAIN. */
  parentWarehouseId: string;
}

/** Stock > Dépôts (phase 15, WAREHOUSES): dépôts and the trucks of the sellers. */
export function WarehousesManager() {
  return (
    <FeatureGate feature={Feature.WAREHOUSES}>
      <Warehouses />
    </FeatureGate>
  );
}

function Warehouses() {
  const t = useTranslations('warehouses');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const tu = useTranslations('multiUnit');
  // Phase 24: dépôts are company settings (SETTINGS_EDIT, owner and manager by default).
  const writer = usePermission(Permission.SETTINGS_EDIT);
  const multiUnit = useFeature(Feature.MULTI_UNIT);
  const warehouses = useWarehouses();
  const sellers = useSellers();
  const save = useSaveWarehouse();
  const archive = useArchiveWarehouse();
  const [editing, setEditing] = useState<Editing | null>(null);

  const submit = () => {
    if (!editing || !editing.name.trim()) return;
    const driver = editing.type === WarehouseType.VEHICLE ? editing.assignedUserId || null : null;
    const body = editing.id
      ? {
          name: editing.name.trim(),
          ...(editing.isDefault ? {} : { active: editing.active }),
          ...(editing.type === WarehouseType.VEHICLE ? { assignedUserId: driver } : {}),
          ...(multiUnit && editing.type === WarehouseType.VEHICLE && editing.parentWarehouseId
            ? { parentWarehouseId: editing.parentWarehouseId }
            : {}),
        }
      : { name: editing.name.trim(), type: editing.type, assignedUserId: driver };
    save.mutate(
      { id: editing.id, body },
      {
        onSuccess: () => {
          toast.success(editing.id ? t('saved') : t('created'));
          setEditing(null);
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  const edit = (w: WarehouseDto) =>
    setEditing({
      id: w.id,
      name: w.name,
      type: w.type === WarehouseType.VEHICLE ? 'VEHICLE' : 'SECONDARY',
      isDefault: w.isDefault,
      assignedUserId: w.assignedUser?.id ?? '',
      active: w.active,
      parentWarehouseId: w.parent?.id ?? '',
    });

  const list = warehouses.data ?? [];

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          writer ? (
            <Button
              onClick={() =>
                setEditing({
                  id: null,
                  name: '',
                  type: 'VEHICLE',
                  isDefault: false,
                  assignedUserId: '',
                  active: true,
                  parentWarehouseId: '',
                })
              }
            >
              <Plus aria-hidden />
              {t('new')}
            </Button>
          ) : undefined
        }
        more={[
          { label: t('transfers'), icon: ArrowLeftRight, href: '/stock/transferts' },
          { label: t('back'), icon: ArrowLeft, flipIcon: true, tone: 'ghost', href: '/stock' },
        ]}
      />

      <Card className="p-0">
        {warehouses.isPending ? (
          <div className="space-y-2 p-4" aria-busy>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : warehouses.isError ? (
          <p role="alert" className="p-4 text-sm text-destructive">
            {errorMessage(warehouses.error)}
          </p>
        ) : list.length === 0 ? (
          <EmptyState
            icon={Warehouse}
            title={t('emptyTitle')}
            description={t('emptyDescription')}
          />
        ) : (
          <ul className="divide-y">
            {list.map((w) => {
              const Icon = w.type === WarehouseType.VEHICLE ? Truck : Warehouse;
              return (
                <li key={w.id} className="flex items-center justify-between gap-2 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 space-y-1">
                      {multiUnit && w.type !== WarehouseType.VEHICLE ? (
                        <Link
                          href={`/stock/depots/${w.id}`}
                          className="block truncate font-medium underline-offset-4 hover:underline"
                          title={w.name}
                          aria-label={tu('open', { name: w.name })}
                        >
                          {w.name}
                        </Link>
                      ) : (
                        <p className="truncate font-medium" title={w.name}>
                          {w.name}
                        </p>
                      )}
                      <p className="truncate text-xs text-muted-foreground">
                        {[
                          t(`type${w.type}`),
                          multiUnit ? (w.parent?.name ?? w.manager?.fullName ?? null) : null,
                          w.assignedUser?.fullName ??
                            (w.type === WarehouseType.VEHICLE ? t('noDriver') : null),
                          t('productCount', { count: w.productCount }),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {w.isDefault ? <Badge variant="secondary">{t('default')}</Badge> : null}
                    {!w.active ? <Badge variant="outline">{t('inactive')}</Badge> : null}
                    {writer ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11"
                        aria-label={t('editNamed', { name: w.name })}
                        onClick={() => edit(w)}
                      >
                        <Pencil aria-hidden />
                      </Button>
                    ) : null}
                    {writer && !w.isDefault ? (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-11"
                            aria-label={t('archiveNamed', { name: w.name })}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t('archiveTitle')}</AlertDialogTitle>
                            <AlertDialogDescription>{t('archiveBody')}</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{tc('cancel')}</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() =>
                                archive.mutate(w.id, {
                                  onSuccess: () => toast.success(t('archived')),
                                  onError: (err) => toast.error(errorMessage(err)),
                                })
                              }
                            >
                              {t('archive')}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <ResponsiveDialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <ResponsiveDialogContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>{editing?.id ? t('edit') : t('new')}</ResponsiveDialogTitle>
              <ResponsiveDialogDescription>{t('help')}</ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            <div className="space-y-2">
              <Label htmlFor="warehouse-name">{t('name')}</Label>
              <Input
                id="warehouse-name"
                autoFocus
                required
                maxLength={80}
                value={editing?.name ?? ''}
                onChange={(e) =>
                  setEditing((cur) => (cur ? { ...cur, name: e.target.value } : cur))
                }
              />
            </div>
            {editing && !editing.id ? (
              <div className="space-y-2">
                <Label htmlFor="warehouse-type">{t('type')}</Label>
                <NativeSelect
                  id="warehouse-type"
                  value={editing.type}
                  onChange={(e) =>
                    setEditing((cur) =>
                      cur ? { ...cur, type: e.target.value as Editing['type'] } : cur,
                    )
                  }
                >
                  <option value="VEHICLE">{t('typeVEHICLE')}</option>
                  <option value="SECONDARY">{t('typeSECONDARY')}</option>
                </NativeSelect>
              </div>
            ) : null}
            {editing?.type === 'VEHICLE' && !editing.isDefault ? (
              <div className="space-y-2">
                <Label htmlFor="warehouse-driver">{t('driver')}</Label>
                <NativeSelect
                  id="warehouse-driver"
                  value={editing.assignedUserId}
                  onChange={(e) =>
                    setEditing((cur) => (cur ? { ...cur, assignedUserId: e.target.value } : cur))
                  }
                >
                  <option value="">{t('noDriver')}</option>
                  {(sellers.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fullName}
                    </option>
                  ))}
                </NativeSelect>
                <p className="text-xs text-muted-foreground">{t('driverHint')}</p>
              </div>
            ) : null}
            {multiUnit && editing?.id && editing.type === 'VEHICLE' ? (
              <div className="space-y-2">
                <Label htmlFor="warehouse-parent">{tu('parent')}</Label>
                <NativeSelect
                  id="warehouse-parent"
                  value={editing.parentWarehouseId}
                  onChange={(e) =>
                    setEditing((cur) => (cur ? { ...cur, parentWarehouseId: e.target.value } : cur))
                  }
                >
                  {list
                    .filter((d) => d.type !== WarehouseType.VEHICLE)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                </NativeSelect>
              </div>
            ) : null}
            {editing?.id && !editing.isDefault ? (
              <div className="flex min-h-11 items-center gap-2">
                <Switch
                  id="warehouse-active"
                  checked={editing.active}
                  onCheckedChange={(active) =>
                    setEditing((cur) => (cur ? { ...cur, active } : cur))
                  }
                />
                <Label htmlFor="warehouse-active" className="font-normal">
                  {t('active')}
                </Label>
              </div>
            ) : null}
            <ResponsiveDialogFooter>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                {tc('cancel')}
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {tc('save')}
              </Button>
            </ResponsiveDialogFooter>
          </form>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
