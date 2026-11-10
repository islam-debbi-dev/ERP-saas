'use client';

import { useEffect, useRef, useState } from 'react';
import { money } from '@erp/shared';

/** The longest a figure may move (docs/ui.md: motion ≤ 300 ms). */
export const COUNT_UP_MS = 300;

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * A figure that changed after a refetch (phase 33) counts from the old value to the new
 * one in ≤ 300 ms and flashes once; never on first load, never under reduced motion. The
 * steps are display only (decimal.js, no float on money); the last text is `raw` itself.
 */
export function useCountUp(raw: string | null): { value: string | null; flash: boolean } {
  const previous = useRef(raw);
  const [frame, setFrame] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    const before = previous.current;
    previous.current = raw;
    if (before === null || raw === null || before === raw || prefersReducedMotion()) return;
    const from = money(before);
    const to = money(raw);
    let start: number | null = null;
    let id = 0;
    const step = (now: number) => {
      start ??= now;
      const k = Math.min((now - start) / COUNT_UP_MS, 1);
      if (k < 1) {
        setFlash(true);
        setFrame(from.plus(to.minus(from).times(k)).toFixed(2));
        id = requestAnimationFrame(step);
      } else {
        setFrame(null);
        setFlash(false);
      }
    };
    id = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(id);
      setFrame(null);
      setFlash(false);
    };
  }, [raw]);

  return { value: frame ?? raw, flash };
}
