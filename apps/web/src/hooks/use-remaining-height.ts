'use client';

import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * The height that takes an element from its top edge to the bottom of the screen, less
 * what must stay visible under it (`below`) and a margin.
 *
 * For a box that should fill "the rest of the screen" under content whose height is not
 * known (banners that come and go, text that wraps in another language). A `calc()` with a
 * guessed offset is wrong as soon as one more row shows above (REPORT-35, D-1).
 *
 * Measured against the document, so scrolling does not change it. `null` until measured.
 */
export function useRemainingHeight<T extends HTMLElement, B extends HTMLElement = HTMLElement>({
  below,
  margin = 16,
  min = 240,
}: {
  below?: RefObject<B | null>;
  margin?: number;
  min?: number;
} = {}) {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState<number | null>(null);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const under = below?.current ? below.current.offsetHeight + 8 : 0;
    setHeight(Math.max(min, Math.floor(window.innerHeight - top - under - margin)));
  }, [below, margin, min]);

  // After every render of the caller: a banner above may have come or gone.
  useLayoutEffect(measure);

  useEffect(() => {
    // The body changes size when anything above wraps, loads or disappears.
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  return [ref, height] as const;
}
