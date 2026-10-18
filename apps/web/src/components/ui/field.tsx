import type * as React from 'react';
import { cn } from '@/lib/utils';
import { Label } from './label';

/** Label + control + hint/error, with the error read by screen readers. */
export function Field({
  id,
  label,
  hint,
  error,
  optional,
  optionalLabel,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  optionalLabel?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {optional && optionalLabel ? (
          <span className="ml-1.5 font-normal text-muted-foreground">({optionalLabel})</span>
        ) : null}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** aria props tying a control to its Field hint/error. */
export function fieldAria(id: string, error?: string, hint?: string) {
  return {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-error` : hint ? `${id}-hint` : undefined,
  } as const;
}
