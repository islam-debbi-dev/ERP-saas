import { Boxes } from 'lucide-react';
import { cn } from '@/lib/utils';

/** App mark until a real logo exists: the icon on a soft primary tile. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary',
        className,
      )}
      aria-hidden
    >
      <Boxes className="size-[60%]" />
    </span>
  );
}
