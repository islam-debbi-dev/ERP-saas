import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The main action of a form (docs/ui.md rule 3). On a phone it sticks to the
 * bottom of the screen, above the home indicator, so the save button is always
 * one thumb away. From `md` up it is a plain row at the end of the form.
 */
export function StickyActions({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="sticky-actions"
      className={cn(
        'sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-background/80',
        'md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none',
        // On a phone the buttons share the width: big targets, no hunting.
        'max-md:[&>*]:flex-1',
        className,
      )}
    >
      {children}
    </div>
  );
}
