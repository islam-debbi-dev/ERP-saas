'use client';

import { Loader2, Truck } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { type WorkerVehiclePeriodDto } from '@erp/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useErrorMessage } from '@/lib/use-error-message';
import { useWorkerVehicles } from '@/lib/vehicles';
import { VehicleCode, vehicleLabel } from './vehicle-code';

/**
 * "Véhicules conduits": the trucks a worker drove, one row per period, newest first. The
 * owner follows the worker across trucks as well as the truck across workers.
 */
export function UserVehiclesDialog({
  user,
  onOpenChange,
}: {
  user: { id: string; fullName: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('vehicles');
  const errorMessage = useErrorMessage();
  const periods = useWorkerVehicles(user?.id ?? null);
  const items = periods.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <ResponsiveDialog open={user !== null} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="md:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {user ? t('drivenNamed', { name: user.fullName }) : ''}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{t('drivenHelp')}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {periods.isPending ? (
          <div className="space-y-2" aria-busy>
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : periods.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(periods.error)}
          </p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <Truck className="size-8 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">{t('drivenEmpty')}</p>
          </div>
        ) : (
          <ul className="divide-y rounded-lg border" data-testid="driven-vehicles">
            {items.map((p) => (
              <li key={p.id}>
                <Period period={p} />
              </li>
            ))}
          </ul>
        )}
        {periods.hasNextPage ? (
          <Button
            variant="outline"
            onClick={() => void periods.fetchNextPage()}
            disabled={periods.isFetchingNextPage}
          >
            {periods.isFetchingNextPage ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t('loadMore')}
          </Button>
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function Period({ period: p }: { period: WorkerVehiclePeriodDto }) {
  const t = useTranslations('vehicles');
  const format = useFormatter();
  const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });
  const body = (
    <>
      <span className="min-w-0 space-y-0.5">
        <span className="block truncate font-medium">
          {p.vehicle.code ? <VehicleCode code={p.vehicle.code} /> : p.vehicle.name}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {[p.vehicle.code ? p.vehicle.name : null, p.vehicle.type?.name]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <span className="block text-xs text-muted-foreground">
          {p.toAt
            ? t('period', { from: day(p.fromAt), to: day(p.toAt) })
            : t('periodOpen', { from: day(p.fromAt) })}
        </span>
      </span>
      {p.toAt ? null : (
        <Badge variant="outline" className="shrink-0 border-emerald-500/50">
          {t('ongoing')}
        </Badge>
      )}
    </>
  );
  const row = 'flex min-h-14 items-center justify-between gap-3 px-3 py-2.5';
  // A truck outside the reader's dépôts is named, without a link.
  return p.vehicle.inReach ? (
    <Link
      href={`/stock/vehicules?vehicle=${p.vehicle.id}`}
      aria-label={t('openVehicle', { name: vehicleLabel(p.vehicle) })}
      className={`${row} transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none`}
    >
      {body}
    </Link>
  ) : (
    <div className={row}>{body}</div>
  );
}
