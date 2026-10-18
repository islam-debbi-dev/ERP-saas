import { cn } from '@/lib/utils';

/** A keyboard key, as shown in shortcut hints. */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      dir="ltr"
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted px-1 font-sans text-[11px] font-medium text-muted-foreground',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
