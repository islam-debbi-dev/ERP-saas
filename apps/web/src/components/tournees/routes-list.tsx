'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChartColumn, HandCoins, Loader2, MapPinned, Plus, Truck, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  type CreateRouteInput,
  Feature,
  type RouteDto,
  type RouteVehicleDto,
  OFFICE_ROLES,
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
import { DriverDialog, type DriverTarget } from '@/components/vehicles/driver-dialog';
import { isolateLtr, VehicleCode } from '@/components/vehicles/vehicle-code';
import { api } from '@/lib/api-client';
import { useAuth, useFeature } from '@/lib/auth';
import { useSellers } from '@/lib/sales-force';
import { tourneeKeys, useRoutes } from '@/lib/tournees';
import { useErrorMessage } from '@/lib/use-error-message';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';
import { useConvertAllRoutes, useConvertRoute, useVehicles } from '@/lib/vehicles';
import { WeekdayPicker, useWeekdayLabels } from './weekdays';

/**
 * Tournées (phase 16), planned per vehicle since phase 36: the list is grouped by truck,
 * with who drives it today. Old routes planned for a seller come after, with "Convertir".
 */
export function RoutesList() {
  return (
    <FeatureGate feature={Feature.TOURNEES}>
      <Routes />
    </FeatureGate>
  );
}

function Routes() {
  const t = useTranslations('tournees');
  const tv = useTranslations('vehicles');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const role = useAuth().state.user?.role;
  const planner = !!role && OFFICE_ROLES.includes(role);
  const routes = useRoutes();
  const vehicles = useVehicles();
  const convert = useConvertRoute();
  const convertAll = useConvertAllRoutes();
  const [creating, setCreating] = useState(false);
  const [driverOf, setDriverOf] = useState<DriverTarget | null>(null);
  const list = useMemo(() => routes.data ?? [], [routes.data]);

  const groups = useMemo(() => {
    const byVehicle = new Map<string, { vehicle: RouteVehicleDto; routes: RouteDto[] }>();
    for (const r of list) {
      if (!r.vehicle) continue;
      const g = byVehicle.get(r.vehicle.id) ?? { vehicle: r.vehicle, routes: [] };
      g.routes.push(r);
      byVehicle.set(r.vehicle.id, g);
    }
    return [...byVehicle.values()].sort((a, b) =>
      (a.vehicle.code ?? a.vehicle.name).localeCompare(b.vehicle.code ?? b.vehicle.name),
    );
  }, [list]);
  const sellerRoutes = list.filter((r) => !r.vehicle);
  // A seller route can follow a truck once its seller drives one.
  const drivers = new Set((vehicles.data ?? []).map((v) => v.assignedUser?.id).filter(Boolean));
  const convertible = sellerRoutes.filter((r) => r.seller && drivers.has(r.seller.id));

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          planner ? (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              {t('newRoute')}
            </Button>
          ) : undefined
        }
        more={[
          planner && { label: tv('title'), icon: Truck, href: '/stock/vehicules' },
          { label: t('closingTitle'), icon: HandCoins, href: '/tournees/cloture' },
          { label: t('reportTitle'), icon: ChartColumn, href: '/tournees/rapports' },
        ]}
      />

      {planner && convertible.length > 0 ? (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium">{tv('convertBannerTitle', { count: convertible.length })}</p>
            <p className="text-sm text-muted-foreground">{tv('convertBannerBody')}</p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="shrink-0" disabled={convertAll.isPending}>
                {convertAll.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {tv('convertAll')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {tv('convertAllTitle', { count: convertible.length })}
                </AlertDialogTitle>
                <AlertDialogDescription>{tv('convertAllBody')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{tc('cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() =>
                    convertAll.mutate(undefined, {
                      onSuccess: (r) => toast.success(tv('convertedCount', { count: r.converted })),
                      onError: (err) => toast.error(errorMessage(err)),
                    })
                  }
                >
                  {tv('convertAll')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : null}

      {routes.isPending ? (
        <Card className="space-y-2 p-4" aria-busy>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </Card>
      ) : routes.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(routes.error)}
        </p>
      ) : list.length === 0 ? (
        <Card className="p-0">
          <EmptyState
            icon={MapPinned}
            title={t('emptyTitle')}
            description={t('emptyDescription')}
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map(({ vehicle, routes: own }) => (
            <Card key={vehicle.id} className="gap-0 p-0" data-testid="vehicle-routes">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b bg-muted/40 px-4 py-3">
                <div className="min-w-0">
                  <h2 className="flex min-w-0 items-baseline gap-2 text-base font-semibold">
                    <Truck
                      className="size-4 shrink-0 self-center text-muted-foreground"
                      aria-hidden
                    />
                    {vehicle.code ? <VehicleCode code={vehicle.code} className="shrink-0" /> : null}
                    <span
                      className={
                        vehicle.code
                          ? 'truncate text-sm font-normal text-muted-foreground'
                          : 'truncate'
                      }
                    >
                      {vehicle.name}
                    </span>
                  </h2>
                  <p className="mt-0.5 flex items-center gap-1.5 text-sm">
                    <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate" data-testid="route-driver">
                      {vehicle.driver?.fullName ?? (
                        <span className="text-muted-foreground">{tv('noDriver')}</span>
                      )}
                    </span>
                  </p>
                </div>
                {planner ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11 shrink-0"
                    onClick={() =>
                      setDriverOf({
                        id: vehicle.id,
                        code: vehicle.code,
                        name: vehicle.name,
                        driver: vehicle.driver,
                      })
                    }
                  >
                    {tv('whoDrives')}
                  </Button>
                ) : null}
              </div>
              <ul className="divide-y">
                {own.map((r) => (
                  <li key={r.id}>
                    <RouteRow route={r} />
                  </li>
                ))}
              </ul>
            </Card>
          ))}

          {sellerRoutes.length > 0 ? (
            <Card className="gap-0 p-0" data-testid="seller-routes">
              {groups.length > 0 ? (
                <h2 className="border-b bg-muted/40 px-4 py-3 text-base font-semibold">
                  {tv('sellerRoutes')}
                </h2>
              ) : null}
              <ul className="divide-y">
                {sellerRoutes.map((r) => (
                  <li key={r.id} className="flex items-center">
                    <div className="min-w-0 flex-1">
                      <RouteRow route={r} />
                    </div>
                    {planner && r.seller && drivers.has(r.seller.id) ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="me-3 min-h-11 shrink-0"
                        aria-label={tv('convertNamed', { name: r.name })}
                        title={tv('convertHelp')}
                        disabled={convert.isPending}
                        onClick={() =>
                          convert.mutate(r.id, {
                            onSuccess: () => toast.success(tv('converted')),
                            onError: (err) => toast.error(errorMessage(err)),
                          })
                        }
                      >
                        {tv('convert')}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      )}

      <NewRouteDialog open={creating} onOpenChange={setCreating} />
      <DriverDialog vehicle={driverOf} onOpenChange={(o) => !o && setDriverOf(null)} />
    </>
  );
}

function RouteRow({ route: r }: { route: RouteDto }) {
  const t = useTranslations('tournees');
  const dayLabel = useWeekdayLabels('short');
  return (
    <Link
      href={`/tournees/${r.id}`}
      className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
    >
      <div className="min-w-0">
        <p className="truncate font-medium">{r.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {[r.seller?.fullName, r.weekdays.map((d) => dayLabel(d)).join(', ')]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {!r.active ? <Badge variant="outline">{t('inactive')}</Badge> : null}
        <Badge variant="secondary">{t('stopCount', { count: r.stopCount })}</Badge>
      </div>
    </Link>
  );
}

function NewRouteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('tournees');
  const tv = useTranslations('vehicles');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const queryClient = useQueryClient();
  const warehousesOn = useFeature(Feature.WAREHOUSES);
  const sellers = useSellers({ orderTakers: true });
  const vehicles = useVehicles();
  const key = useIdempotencyKey(open);
  const [name, setName] = useState('');
  // A tournée is planned for a vehicle; "pour un vendeur" stays for companies without trucks.
  const [forSeller, setForSeller] = useState(false);
  const [vehicleId, setVehicleId] = useState('');
  const [sellerId, setSellerId] = useState('');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const trucks = (vehicles.data ?? []).filter((v) => v.active);
  const bySeller = forSeller || !warehousesOn;

  const create = useMutation({
    mutationFn: (body: CreateRouteInput) =>
      api.request<RouteDto>('/routes', { method: 'POST', body, idempotencyKey: key }),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: tourneeKeys.routes });
      onOpenChange(false);
      router.push(`/tournees/${r.id}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const owner = bySeller ? sellerId : vehicleId;
  const valid = name.trim().length > 0 && owner !== '' && weekdays.length > 0;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            create.mutate({
              name: name.trim(),
              ...(bySeller ? { sellerId } : { vehicleId }),
              weekdays,
              active: true,
            });
          }}
        >
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t('newRoute')}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>{t('newRouteHelp')}</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          {bySeller ? (
            <div className="space-y-2">
              <Label htmlFor="route-seller">{t('seller')}</Label>
              <NativeSelect
                id="route-seller"
                value={sellerId}
                onChange={(e) => setSellerId(e.target.value)}
              >
                <option value="">{t('pickSeller')}</option>
                {(sellers.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.fullName}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="route-vehicle">{tv('routeVehicle')}</Label>
              <NativeSelect
                id="route-vehicle"
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
              >
                <option value="">{tv('pickVehicle')}</option>
                {trucks.map((v) => (
                  <option key={v.id} value={v.id}>
                    {[
                      v.code ? isolateLtr(v.code) : v.name,
                      v.vehicleType ? isolateLtr(v.vehicleType.code) : null,
                      v.assignedUser?.fullName ?? tv('noDriver'),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </option>
                ))}
              </NativeSelect>
              {vehicles.data && trucks.length === 0 ? (
                <p className="text-xs text-muted-foreground">{tv('noVehicles')}</p>
              ) : null}
            </div>
          )}
          {warehousesOn ? (
            <button
              type="button"
              className="min-h-11 justify-self-start text-start text-sm font-medium text-primary underline underline-offset-4"
              onClick={() => setForSeller((v) => !v)}
            >
              {forSeller ? tv('forVehicle') : tv('forSeller')}
            </button>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="route-name">{t('routeName')}</Label>
            <Input
              id="route-name"
              value={name}
              maxLength={80}
              placeholder={t('routeNamePlaceholder')}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <WeekdayPicker value={weekdays} onChange={setWeekdays} />
          <ResponsiveDialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={!valid || create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t('createRoute')}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
