import type * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Native <select> styled like Input. Kept native on purpose: typing a letter
 * jumps to the option, which fast typists rely on.
 */
export function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        'border-input dark:bg-input/30 flex h-9 w-full min-w-0 cursor-pointer rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        className,
      )}
      {...props}
    />
  );
}
