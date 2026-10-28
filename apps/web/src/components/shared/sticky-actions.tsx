'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * The main action of a form (docs/ui.md rule 3). On a phone it is fixed to the
 * bottom of the screen, above the home indicator, so the save button is always
 * one thumb away whatever part of the form is on screen; a spacer of the same
 * height keeps the end of the page from hiding under it. From `md` up it is a
 * plain row at the end of the form.
 */
export function StickyActions({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div aria-hidden className="md:hidden" style={{ height }} />
      <div
        ref={bar}
        data-slot="sticky-actions"
        className={cn(
          'fixed inset-x-0 bottom-0 z-30 flex flex-wrap items-center justify-end gap-2 border-t bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_-8px_rgb(0_0_0/0.2)] backdrop-blur supports-[backdrop-filter]:bg-background/85',
          'md:static md:z-auto md:border-0 md:bg-transparent md:p-0 md:shadow-none md:backdrop-blur-none',
          // On a phone the buttons share the width: big targets, no hunting.
          'max-md:[&>button]:flex-1 max-md:[&>a]:flex-1',
          className,
        )}
      >
        {children}
      </div>
    </>
  );
}
