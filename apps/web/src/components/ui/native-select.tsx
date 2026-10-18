import type * as React from 'react';
import { cn } from '@/lib/utils';

/** Native <select>: instant keyboard selection by typing, which fast typists rely on. */
export function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-10 w-full cursor-pointer rounded-md border border-input bg-card px-3 text-[0.9375rem] focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:bg-muted',
        className,
      )}
      {...props}
    />
  );
}
