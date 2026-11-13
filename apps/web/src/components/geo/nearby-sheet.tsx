'use client';

import { MapPinOff, Navigation, Phone, RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  type ClientNearbyPointDto,
  directionsUrl,
  formatDistanceM,
  type LatLng,
} from '@erp/shared';
import { BalanceAmount } from '@/components/clients/balance-amount';
import { EmptyState } from '@/components/shared/empty-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { type ClientMapFilters, useNearbyClients } from '@/lib/client-map';
import { useErrorMessage } from '@/lib/use-error-message';
import { cn } from '@/lib/utils';

export const NEARBY_RADII = [1000, 5000, 10_000, 25_000] as const;

/**
 * Above this the phone has no GPS fix (cell towers, Wi-Fi): distances listed to the metre
 * from such a point would lie, so the sheet says how rough the position is.
 */
export const VAGUE_POSITION_M = 100;

/**
 * "Clients proches" (phase 35): the clients around a point (me, or a client), nearest
 * first, straight-line distances. Same filters and scope as the map.
 */
export function NearbySheet({
  open,
  onOpenChange,
  center,
  accuracyM,
  around,
  filters,
  radiusM,
  onRadiusChange,
  onShow,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  center: LatLng | null;
  /** How precise `center` is, when it is the user's own position. */
  accuracyM?: number | null;
  /** Who the list is around: "vous" or a client's name. */
  around: string;
  filters: ClientMapFilters;
  radiusM: number;
  onRadiusChange: (m: number) => void;
  /** Show this client on the map. */
  onShow: (client: ClientNearbyPointDto) => void;
}) {
  const t = useTranslations('clientMap');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const near = useNearbyClients(filters, open ? center : null, radiusM);
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="md:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('nearbyTitle')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{t('nearbyHelp', { around })}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div role="radiogroup" aria-label={t('radius')} className="flex flex-wrap gap-2">
          {NEARBY_RADII.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={radiusM === r}
              onClick={() => onRadiusChange(r)}
              className={cn(
                'num h-11 min-w-16 rounded-full border px-4 text-sm font-medium',
                radiusM === r
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-background hover:bg-muted',
              )}
            >
              <span dir="ltr">{formatDistanceM(r)}</span>
            </button>
          ))}
        </div>
        {accuracyM != null && accuracyM > VAGUE_POSITION_M ? (
          <p role="status" className="rounded-md bg-amber-500/15 px-3 py-2 text-sm">
            {t.rich('positionApprox', {
              distance: () => (
                <span className="num whitespace-nowrap" dir="ltr">
                  ± {formatDistanceM(accuracyM)}
                </span>
              ),
            })}
          </p>
        ) : null}
        {near.isPending ? (
          <div className="space-y-2" aria-busy>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : near.isError ? (
          // Never the empty state here: "no client around you" would be false (no signal,
          // server error, permission revoked).
          <Alert variant="destructive" data-testid="nearby-error">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              <span>{errorMessage(near.error)}</span>
              <Button
                variant="outline"
                className="h-11"
                onClick={() => void near.refetch()}
                disabled={near.isFetching}
              >
                <RotateCw aria-hidden className={cn(near.isFetching && 'animate-spin')} />
                {tc('retry')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : !near.data || near.data.length === 0 ? (
          <EmptyState icon={MapPinOff} title={t('nearbyEmpty')} />
        ) : (
          <ul className="divide-y rounded-md border" data-testid="nearby-list">
            {near.data.map((c) => (
              <li key={c.id} className="flex items-center gap-2 px-3 py-2">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-start"
                  onClick={() => onShow(c)}
                >
                  <span className="block truncate font-medium" dir="auto">
                    {c.name}
                  </span>
                  {/* Second line: at 360 px the balance next to the name left it 76 px. */}
                  <span className="mt-0.5 flex items-center justify-between gap-2">
                    <span
                      className="num text-xs text-muted-foreground"
                      dir="ltr"
                      data-testid="nearby-distance"
                    >
                      {formatDistanceM(c.distanceM)}
                    </span>
                    <BalanceAmount value={c.balance} showHint={false} className="text-sm" />
                  </span>
                </button>
                {c.phone ? (
                  <Button asChild variant="ghost" size="icon" className="size-11 shrink-0">
                    <a href={`tel:${c.phone}`} aria-label={t('callName', { name: c.name })}>
                      <Phone aria-hidden />
                    </a>
                  </Button>
                ) : null}
                <Button asChild variant="ghost" size="icon" className="size-11 shrink-0">
                  <a
                    href={directionsUrl(c)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t('directionsName', { name: c.name })}
                  >
                    <Navigation aria-hidden />
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">{t('straightLineNote')}</p>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
