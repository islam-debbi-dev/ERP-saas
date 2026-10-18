import type * as React from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-md border border-input bg-card px-3 text-[0.9375rem] transition-colors placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:bg-muted aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}
