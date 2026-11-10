'use client';

import { ArrowDown, RefreshCw } from 'lucide-react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** "Mis à jour il y a 2 min" and a refresh button (44 px), under the header (phase 33). */
export function UpdatedBar({
  updatedAt,
  fetching,
  onRefresh,
}: {
  /** ms epoch of the last successful fetch; 0 before the first one. */
  updatedAt: number;
  fetching: boolean;
  onRefresh: () => void;
}) {
  const t = useTranslations('dashboard');
  const format = useFormatter();
  // Re-renders every 30 s so "il y a" stays true.
  const now = useNow({ updateInterval: 30_000 });
  // Same height before the first fetch: the cards below never jump.
  if (!updatedAt) return <div className="min-h-11" aria-hidden />;
  const fresh = now.getTime() - updatedAt < 60_000;
  return (
    <div className="flex min-h-11 items-center justify-end gap-1 text-xs text-muted-foreground">
      <span aria-live="polite">
        {fresh ? t('updatedNow') : t('updatedAgo', { ago: format.relativeTime(updatedAt, now) })}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-11"
        aria-label={t('refresh')}
        title={t('refresh')}
        disabled={fetching}
        onClick={onRefresh}
      >
        <RefreshCw className={cn('size-4', fetching && 'motion-safe:animate-spin')} aria-hidden />
      </Button>
    </div>
  );
}

/** How far a finger must pull from the top of the page to refresh. */
const PULL_PX = 72;

/**
 * Pull-to-refresh on a phone: a downward drag that starts at the very top of the page.
 * Touch only, so a mouse or a scroll further down never triggers it.
 */
export function PullToRefresh({ onRefresh }: { onRefresh: () => void }) {
  const t = useTranslations('dashboard');
  const [pull, setPull] = useState(0);
  const start = useRef<number | null>(null);
  const refresh = useRef(onRefresh);
  useEffect(() => {
    refresh.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    let distance = 0;
    const down = (e: TouchEvent) => {
      start.current = window.scrollY <= 0 && e.touches.length === 1 ? e.touches[0]!.clientY : null;
      distance = 0;
    };
    const move = (e: TouchEvent) => {
      if (start.current === null) return;
      distance = Math.max(0, e.touches[0]!.clientY - start.current);
      setPull(Math.min(distance, PULL_PX * 1.5));
    };
    const up = () => {
      if (start.current !== null && distance >= PULL_PX) refresh.current();
      start.current = null;
      distance = 0;
      setPull(0);
    };
    window.addEventListener('touchstart', down, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', up);
    window.addEventListener('touchcancel', up);
    return () => {
      window.removeEventListener('touchstart', down);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
      window.removeEventListener('touchcancel', up);
    };
  }, []);

  if (pull < 12) return null;
  const ready = pull >= PULL_PX;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-14 z-40 flex justify-center md:hidden"
    >
      <span className="mt-2 inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs shadow-sm">
        <ArrowDown
          className={cn('size-4 motion-safe:transition-transform', ready && 'rotate-180')}
          aria-hidden
        />
        {ready ? t('pullToRefresh') : t('refresh')}
      </span>
    </div>
  );
}
