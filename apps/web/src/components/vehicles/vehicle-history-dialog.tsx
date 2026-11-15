'use client';

import { Loader2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
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
import { useVehicleHistory } from '@/lib/vehicles';
import { vehicleLabel } from './vehicle-code';

/** Who drove a truck, from when, set by whom (newest first). */
export function VehicleHistoryDialog({
  vehicle,
  onOpenChange,
}: {
  vehicle: { id: string; code: string | null; name: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('vehicles');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const history = useVehicleHistory(vehicle?.id ?? null);
  const items = history.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <ResponsiveDialog open={vehicle !== null} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="md:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {vehicle ? t('historyTitle', { name: vehicleLabel(vehicle) }) : ''}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{t('historyHelp')}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {history.isPending ? (
          <div className="space-y-2" aria-busy>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : history.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(history.error)}
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('historyEmpty')}</p>
        ) : (
          <ol className="divide-y rounded-lg border">
            {items.map((a) => (
              <li key={a.id} className="space-y-0.5 px-3 py-2.5">
                <p className="truncate font-medium">{a.user?.fullName ?? t('noDriver')}</p>
                <p className="text-xs text-muted-foreground">
                  {t('since', {
                    date: format.dateTime(new Date(a.fromAt), {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }),
                  })}
                  {a.setBy ? ` · ${t('setBy', { name: a.setBy.fullName })}` : ''}
                </p>
                {a.reason ? <p className="text-xs">{a.reason}</p> : null}
              </li>
            ))}
          </ol>
        )}
        {history.hasNextPage ? (
          <Button
            variant="outline"
            onClick={() => void history.fetchNextPage()}
            disabled={history.isFetchingNextPage}
          >
            {history.isFetchingNextPage ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t('loadMore')}
          </Button>
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
