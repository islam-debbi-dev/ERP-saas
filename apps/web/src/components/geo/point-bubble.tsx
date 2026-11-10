'use client';

import { Navigation, Phone, UserRound, X } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { directionsUrl, formatDistanceM } from '@erp/shared';
import { BalanceAmount } from '@/components/clients/balance-amount';
import { Button } from '@/components/ui/button';
import type { PointState } from '@/lib/client-map';
import { cn } from '@/lib/utils';
import { POINT_COLORS } from './point-colors';

export interface BubbleClient {
  id: string;
  code: string;
  name: string;
  commune: string | null;
  phone: string | null;
  lat: number;
  lng: number;
  balance?: string;
  state?: PointState;
}

/**
 * The bubble of a tapped client (phase 35), drawn over the bottom of the map rather than
 * as a Leaflet popup: big buttons, RTL text, readable on a phone. The state is written.
 */
export function PointBubble({
  client,
  distanceM,
  extra,
  status,
  onClose,
  className,
}: {
  client: BubbleClient;
  distanceM?: number;
  /** Actions of the screen (add to the tournée, near this client…). */
  extra?: ReactNode;
  /** A word about the point on this screen ("Arrêt 3", "Visité"). */
  status?: string;
  onClose: () => void;
  className?: string;
}) {
  const t = useTranslations('clientMap');
  return (
    <div
      role="dialog"
      aria-label={client.name}
      className={cn(
        'absolute inset-x-2 bottom-2 z-[1000] rounded-lg border bg-background p-3 shadow-lg md:inset-x-auto md:end-3 md:w-96',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold" dir="auto" title={client.name}>
            {client.name}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            <span dir="ltr">{client.code}</span>
            {client.commune ? `, ${client.commune}` : ''}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {client.state ? (
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block size-2.5 rounded-full"
                  style={{ background: POINT_COLORS[client.state] }}
                />
                {t(`state.${client.state}`)}
              </span>
            ) : null}
            {status ? <span className="font-medium">{status}</span> : null}
            {distanceM !== undefined ? (
              <span className="num" dir="ltr">
                {t('straightLine', { distance: formatDistanceM(distanceM) })}
              </span>
            ) : null}
          </p>
        </div>
        {client.balance !== undefined ? (
          <BalanceAmount value={client.balance} className="shrink-0 text-end text-sm" />
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          className="-me-1 -mt-1 size-11 shrink-0"
          aria-label={t('closeBubble')}
          onClick={onClose}
        >
          <X aria-hidden />
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline" className="h-11">
          <Link href={`/clients/${client.id}`}>
            <UserRound aria-hidden />
            {t('openClient')}
          </Link>
        </Button>
        {client.phone ? (
          <Button asChild size="sm" variant="outline" className="h-11">
            <a href={`tel:${client.phone}`}>
              <Phone aria-hidden />
              {t('call')}
            </a>
          </Button>
        ) : null}
        <Button asChild size="sm" variant="outline" className="h-11">
          <a href={directionsUrl(client)} target="_blank" rel="noopener noreferrer">
            <Navigation aria-hidden />
            {t('directions')}
          </a>
        </Button>
        {extra}
      </div>
    </div>
  );
}
