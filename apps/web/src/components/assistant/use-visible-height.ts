import { useEffect, useState } from 'react';

/** How long after a field loses focus the keyboard is considered gone and the height re-read. */
export const KEYBOARD_SETTLE_MS = 300;

/**
 * The height left by the on-screen keyboard, which `100dvh` does not follow on iOS.
 *
 * Returns `null` (the CSS height applies) while the keyboard is closed, and the visual viewport
 * height while it is open. On iOS Safari the `resize` after the keyboard closes can be missed or
 * arrive with the old value, so the height is also re-read on `scroll` and shortly after
 * `focusout`; when the viewport is back to the full window the pixel height is dropped, never
 * kept, so the panel cannot stay short.
 */
export function useVisibleHeight(active: boolean): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!active || !viewport) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () =>
      setHeight(viewport.height >= window.innerHeight - 1 ? null : viewport.height);
    const afterFocusOut = () => {
      clearTimeout(timer);
      timer = setTimeout(update, KEYBOARD_SETTLE_MS);
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    document.addEventListener('focusout', afterFocusOut);
    return () => {
      clearTimeout(timer);
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      document.removeEventListener('focusout', afterFocusOut);
    };
  }, [active]);
  // A closed panel keeps no height: it reopens at full size until the first read.
  return active ? height : null;
}
