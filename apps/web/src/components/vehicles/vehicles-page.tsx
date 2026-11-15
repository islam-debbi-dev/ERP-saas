'use client';

import {
  ArrowLeft,
  ArrowLeftRight,
  History,
  Loader2,
  MapPin,
  Package,
  Pencil,
  Plus,
  Tags,
  Trash2,
  Truck,
  UserRound,
  Wand2,
  Warehouse,
} from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Feature,
  Permission,
  proposeVehicleCode,
  Role,
  type WarehouseDto,
  WarehouseType,
  WILAYAS,
  wilayaLabel,
} from '@erp/shared';
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
import { useAuth, useFeature, usePermission } from '@/lib/auth';
import { useArchiveWarehouse, useSaveWarehouse, useWarehouses } from '@/lib/stock';
import { useErrorMessage } from '@/lib/use-error-message';
import { cn } from '@/lib/utils';
import { useDriverOptions, useVehicleTypes } from '@/lib/vehicles';
import { DriverDialog, type DriverTarget } from './driver-dialog';
import { VehicleCode } from './vehicle-code';
import { VehicleHistoryDialog } from './vehicle-history-dialog';

interface Editing {
  id: string | null;
  name: string;
  code: string;
  vehicleTypeId: string;
  wilayaCode: string;
  plateNumber: string;
  capacityKg: string;
  assignedUserId: string;
  parentWarehouseId: string;
  active: boolean;
}

/** Stock › Véhicules (phase 36): the trucks, their identity and their driver of the day. */
export function VehiclesPage() {
  return (
    <FeatureGate feature={Feature.WAREHOUSES}>
      <Vehicles />
    </FeatureGate>
  );
}

function Vehicles() {
  const t = useTranslations('vehicles');
  const tc = useTranslations('common');
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const role = useAuth().state.user?.role;
  const writer = usePermission(Permission.SETTINGS_EDIT);
  const planner = role === Role.OWNER || role === Role.MANAGER || role === Role.SUPERVISOR;
  const multiUnit = useFeature(Feature.MULTI_UNIT);
  const focused = useSearchParams().get('vehicle');
  const warehouses = useWarehouses();
  const types = useVehicleTypes();
  const drivers = useDriverOptions();
  const save = useSaveWarehouse();
  const archive = useArchiveWarehouse();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [driverOf, setDriverOf] = useState<DriverTarget | null>(null);
  const [historyOf, setHistoryOf] = useState<WarehouseDto | null>(null);
  const [search, setSearch] = useState('');
  const [typeId, setTypeId] = useState('');
  const [wilaya, setWilaya] = useState('');
  const [depotId, setDepotId] = useState('');

  const all = useMemo(() => warehouses.data ?? [], [warehouses.data]);
  const trucks = useMemo(() => all.filter((w) => w.type === WarehouseType.VEHICLE), [all]);
  const depots = useMemo(() => all.filter((w) => w.type !== WarehouseType.VEHICLE), [all]);
  const wilayasInUse = useMemo(
    () =>
      [...new Set(trucks.map((v) => v.wilayaCode).filter((c): c is number => c !== null))].sort(
        (a, b) => a - b,
      ),
    [trucks],
  );
  const needle = search.trim().toLowerCase();
  const list = trucks
    .filter(
      (v) =>
        (!typeId || v.vehicleType?.id === typeId) &&
        (!wilaya || String(v.wilayaCode) === wilaya) &&
        (!depotId || v.parent?.id === depotId) &&
        (!needle || [v.code, v.name, v.plateNumber].some((x) => x?.toLowerCase().includes(needle))),
    )
    // The truck a link pointed to comes first.
    .sort((a, b) => Number(b.id === focused) - Number(a.id === focused));

  const patch = (change: Partial<Editing>) =>
    setEditing((cur) => (cur ? { ...cur, ...change } : cur));
  const open = (v?: WarehouseDto) =>
    setEditing({
      id: v?.id ?? null,
      name: v?.name ?? '',
      code: v?.code ?? '',
      vehicleTypeId: v?.vehicleType?.id ?? '',
      wilayaCode: v?.wilayaCode ? String(v.wilayaCode) : '',
      plateNumber: v?.plateNumber ?? '',
      capacityKg: v?.capacityKg ? String(v.capacityKg) : '',
      assignedUserId: '',
      parentWarehouseId: v?.parent?.id ?? '',
      active: v?.active ?? true,
    });

  const propose = () => {
    if (!editing) return;
    const type = (types.data ?? []).find((x) => x.id === editing.vehicleTypeId);
    patch({
      code: proposeVehicleCode({
        prefix: type?.codePrefix,
        typeCode: type?.code,
        wilayaCode: editing.wilayaCode ? Number(editing.wilayaCode) : null,
        taken: all.filter((w) => w.id !== editing.id && w.code).map((w) => w.code!),
      }),
    });
  };

  const submit = () => {
    if (!editing || !editing.name.trim()) return;
    const capacity = editing.capacityKg.trim() ? Number(editing.capacityKg) : null;
    const identity = {
      code: editing.code.trim() || null,
      vehicleTypeId: editing.vehicleTypeId || null,
      wilayaCode: editing.wilayaCode ? Number(editing.wilayaCode) : null,
      plateNumber: editing.plateNumber.trim() || null,
      capacityKg: capacity,
    };
    const body = editing.id
      ? {
          name: editing.name.trim(),
          active: editing.active,
          ...identity,
          ...(multiUnit && editing.parentWarehouseId
            ? { parentWarehouseId: editing.parentWarehouseId }
            : {}),
        }
      : {
          name: editing.name.trim(),
          type: WarehouseType.VEHICLE,
          assignedUserId: editing.assignedUserId || null,
          ...identity,
        };
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

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          writer ? (
            <Button onClick={() => open()}>
              <Plus aria-hidden />
              {t('new')}
            </Button>
          ) : undefined
        }
        more={[
          writer && { label: t('typesLink'), icon: Tags, href: '/parametres/types-vehicules' },
          { label: t('depotsLink'), icon: Warehouse, href: '/stock/depots' },
          { label: t('transfersLink'), icon: ArrowLeftRight, href: '/stock/transferts' },
          { label: t('back'), icon: ArrowLeft, flipIcon: true, tone: 'ghost', href: '/stock' },
        ]}
      />

      {trucks.length > 0 ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            type="search"
            aria-label={t('search')}
            placeholder={t('search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <NativeSelect
            aria-label={t('filterType')}
            value={typeId}
            onChange={(e) => setTypeId(e.target.value)}
          >
            <option value="">{`${t('filterType')} : ${t('all')}`}</option>
            {(types.data ?? []).map((x) => (
              <option key={x.id} value={x.id}>
                {`⁦${x.code}⁩ · ${x.name}`}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label={t('filterWilaya')}
            value={wilaya}
            onChange={(e) => setWilaya(e.target.value)}
          >
            <option value="">{`${t('filterWilaya')} : ${t('all')}`}</option>
            {wilayasInUse.map((c) => (
              <option key={c} value={c}>
                {wilayaLabel(c, locale)}
              </option>
            ))}
          </NativeSelect>
          {depots.length > 1 ? (
            <NativeSelect
              aria-label={t('filterDepot')}
              value={depotId}
              onChange={(e) => setDepotId(e.target.value)}
            >
              <option value="">{`${t('filterDepot')} : ${t('all')}`}</option>
              {depots.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </NativeSelect>
          ) : null}
        </div>
      ) : null}

      {warehouses.isPending ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-busy>
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
      ) : warehouses.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(warehouses.error)}
        </p>
      ) : trucks.length === 0 ? (
        <Card className="p-0">
          <EmptyState icon={Truck} title={t('emptyTitle')} description={t('emptyDescription')} />
        </Card>
      ) : list.length === 0 ? (
        <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          {t('noMatch')}
        </p>
      ) : (
        <ul
          className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
          data-testid="vehicle-cards"
        >
          {list.map((v) => (
            // min-w-0: a long name truncates instead of widening the card past the screen.
            <li key={v.id} className="min-w-0">
              <Card
                className={cn(
                  'h-full min-w-0 gap-3 p-4',
                  v.id === focused && 'ring-2 ring-primary',
                  !v.active && 'opacity-70',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-0.5">
                    <p className="truncate text-xl font-semibold leading-tight tracking-tight">
                      {v.code ? <VehicleCode code={v.code} /> : v.name}
                    </p>
                    {v.code ? (
                      <p className="truncate text-sm text-muted-foreground" title={v.name}>
                        {v.name}
                      </p>
                    ) : null}
                  </div>
                  {writer ? (
                    <div className="-me-2 -mt-2 flex shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11"
                        aria-label={t('editNamed', { name: v.code ?? v.name })}
                        onClick={() => open(v)}
                      >
                        <Pencil aria-hidden />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-11"
                            aria-label={t('archiveNamed', { name: v.code ?? v.name })}
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
                                archive.mutate(v.id, {
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
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {v.vehicleType ? (
                    <Badge variant="secondary" title={v.vehicleType.name}>
                      <VehicleCode code={v.vehicleType.code} />
                      <span className="ms-1 font-normal">
                        {t(`activity${v.vehicleType.activity}`)}
                      </span>
                    </Badge>
                  ) : (
                    <Badge variant="outline">{t('noType')}</Badge>
                  )}
                  {!v.active ? <Badge variant="outline">{t('inactive')}</Badge> : null}
                </div>

                <dl className="grid gap-1 text-sm">
                  <div className="flex items-center gap-2">
                    <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <dt className="sr-only">{t('wilaya')}</dt>
                    <dd className="truncate">
                      {wilayaLabel(v.wilayaCode, locale) ?? (
                        <span className="text-muted-foreground">{t('noWilaya')}</span>
                      )}
                    </dd>
                  </div>
                  {v.plateNumber || v.capacityKg ? (
                    <div className="flex items-center gap-2">
                      <Truck className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <dt className="sr-only">{t('plate')}</dt>
                      <dd className="flex min-w-0 flex-wrap gap-x-2">
                        {v.plateNumber ? <VehicleCode code={v.plateNumber} /> : null}
                        {v.capacityKg ? (
                          <span className="text-muted-foreground">
                            {t('capacityValue', { kg: v.capacityKg })}
                          </span>
                        ) : null}
                      </dd>
                    </div>
                  ) : null}
                  {multiUnit && v.parent ? (
                    <div className="flex items-center gap-2">
                      <Warehouse className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <dt className="sr-only">{t('depot')}</dt>
                      <dd className="truncate">{v.parent.name}</dd>
                    </div>
                  ) : null}
                </dl>

                <div className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">{t('driver')}</p>
                      <p className="truncate text-sm font-medium" data-testid="vehicle-driver">
                        {v.assignedUser?.fullName ?? t('noDriver')}
                      </p>
                    </div>
                  </div>
                  {planner ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11 shrink-0"
                      aria-label={t('changeDriverNamed', { name: v.code ?? v.name })}
                      onClick={() =>
                        setDriverOf({
                          id: v.id,
                          code: v.code,
                          name: v.name,
                          driver: v.assignedUser,
                        })
                      }
                    >
                      {t('changeDriver')}
                    </Button>
                  ) : null}
                </div>

                <div className="mt-auto flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-11"
                    onClick={() => setHistoryOf(v)}
                  >
                    <History aria-hidden />
                    {t('history')}
                  </Button>
                  <Button asChild variant="ghost" size="sm" className="min-h-11">
                    <Link
                      href={`/stock?warehouseId=${v.id}`}
                      aria-label={t('stockNamed', { name: v.code ?? v.name })}
                    >
                      <Package aria-hidden />
                      {t('stock')} · {t('productCount', { count: v.productCount })}
                    </Link>
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <DriverDialog vehicle={driverOf} onOpenChange={(o) => !o && setDriverOf(null)} />
      <VehicleHistoryDialog vehicle={historyOf} onOpenChange={(o) => !o && setHistoryOf(null)} />

      <ResponsiveDialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <ResponsiveDialogContent className="md:max-w-lg">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>{editing?.id ? t('edit') : t('new')}</ResponsiveDialogTitle>
              <ResponsiveDialogDescription>{t('subtitle')}</ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="vehicle-type">{t('type')}</Label>
                <NativeSelect
                  id="vehicle-type"
                  value={editing?.vehicleTypeId ?? ''}
                  onChange={(e) => patch({ vehicleTypeId: e.target.value })}
                >
                  <option value="">{t('noType')}</option>
                  {(types.data ?? []).map((x) => (
                    <option key={x.id} value={x.id}>
                      {`⁦${x.code}⁩ · ${x.name}`}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label htmlFor="vehicle-wilaya">{t('wilaya')}</Label>
                <NativeSelect
                  id="vehicle-wilaya"
                  value={editing?.wilayaCode ?? ''}
                  onChange={(e) => patch({ wilayaCode: e.target.value })}
                >
                  <option value="">{t('noWilaya')}</option>
                  {WILAYAS.map((w) => (
                    <option key={w.code} value={w.code}>
                      {wilayaLabel(w.code, locale)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="vehicle-code">{t('code')}</Label>
              <div className="flex gap-2">
                <Input
                  id="vehicle-code"
                  dir="ltr"
                  maxLength={30}
                  autoCapitalize="characters"
                  className="min-w-0 flex-1"
                  value={editing?.code ?? ''}
                  onChange={(e) => patch({ code: e.target.value })}
                />
                <Button type="button" variant="outline" className="shrink-0" onClick={propose}>
                  <Wand2 aria-hidden />
                  <span className="sr-only sm:not-sr-only">{t('proposeCode')}</span>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t('codeHint')}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="vehicle-name">{t('name')}</Label>
              <Input
                id="vehicle-name"
                required
                maxLength={80}
                value={editing?.name ?? ''}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="vehicle-plate">{t('plate')}</Label>
                <Input
                  id="vehicle-plate"
                  dir="ltr"
                  maxLength={20}
                  value={editing?.plateNumber ?? ''}
                  onChange={(e) => patch({ plateNumber: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vehicle-capacity">{t('capacity')}</Label>
                <Input
                  id="vehicle-capacity"
                  dir="ltr"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={7}
                  value={editing?.capacityKg ?? ''}
                  onChange={(e) => patch({ capacityKg: e.target.value.replace(/\D/g, '') })}
                />
              </div>
            </div>
            {editing && !editing.id ? (
              <div className="space-y-2">
                <Label htmlFor="vehicle-driver">{t('driver')}</Label>
                <NativeSelect
                  id="vehicle-driver"
                  value={editing.assignedUserId}
                  onChange={(e) => patch({ assignedUserId: e.target.value })}
                >
                  <option value="">{t('noDriver')}</option>
                  {drivers
                    .filter((d) => !trucks.some((v) => v.assignedUser?.id === d.id))
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.fullName}
                      </option>
                    ))}
                </NativeSelect>
              </div>
            ) : null}
            {multiUnit && editing?.id && depots.length > 1 ? (
              <div className="space-y-2">
                <Label htmlFor="vehicle-depot">{t('depot')}</Label>
                <NativeSelect
                  id="vehicle-depot"
                  value={editing.parentWarehouseId}
                  onChange={(e) => patch({ parentWarehouseId: e.target.value })}
                >
                  {depots.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            ) : null}
            {editing?.id ? (
              <div className="flex min-h-11 items-center gap-2">
                <Switch
                  id="vehicle-active"
                  checked={editing.active}
                  onCheckedChange={(active) => patch({ active })}
                />
                <Label htmlFor="vehicle-active" className="font-normal">
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
