'use client';

import { useEffect, useRef } from 'react';

const MARK = 'leaveGuard';

/** Guards currently armed on the page (React re-runs effects; two forms could be dirty). */
let armed = 0;

const isMarked = (): boolean =>
  (window.history.state as Record<string, unknown> | null)?.[MARK] === true;

/**
 * Asks before leaving the page while `dirty`, by every way out:
 *
 * - closing the tab or reloading: `beforeunload` (the browser's own prompt);
 * - a link of the app: a click on an `<a>` is a client-side navigation in Next.js, which
 *   never fires `beforeunload`;
 * - the back button, which is how a phone user leaves a full-screen page: no event can
 *   cancel it, so a twin of the current history entry is pushed while dirty. "Back" then
 *   lands on the same page, where the question is asked: yes goes back once more, no puts
 *   the twin back.
 *
 * `router.push()` after a save or an archive is the app's own decision and is not asked.
 * (REPORT-35, D-4: the route editor lost its unsaved stops on "back" without a word.)
 */
export function useLeaveGuard(dirty: boolean, message: string): void {
  const text = useRef(message);
  useEffect(() => {
    text.current = message;
  }, [message]);

  useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (e: BeforeUnloadEvent): void => e.preventDefault();

    const onClick = (e: MouseEvent): void => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // opens elsewhere
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const to = new URL(a.href, window.location.href);
      if (to.origin !== window.location.origin) return; // a full unload: beforeunload asks
      if (to.pathname === window.location.pathname && to.search === window.location.search) return;
      if (window.confirm(text.current)) return;
      e.preventDefault();
      e.stopPropagation();
    };

    // Next.js copies its own router state into the new entry (app-router patches pushState).
    const arm = (): void => window.history.pushState({ [MARK]: true }, '');
    let leaving = false;
    const onPopState = (): void => {
      if (leaving || isMarked()) return;
      if (window.confirm(text.current)) {
        leaving = true;
        window.history.back();
      } else {
        arm();
      }
    };

    armed++;
    if (!isMarked()) arm();
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', onPopState);
      armed--;
      if (leaving) return;
      // Saved: drop the twin, or "back" would need two presses. Only if it is still on top
      // (after a navigation the current entry is another page's), and only once no guard
      // took over in the same tick (an effect that re-runs must not pop its own twin).
      window.setTimeout(() => {
        if (armed === 0 && isMarked()) window.history.back();
      }, 0);
    };
  }, [dirty]);
}
