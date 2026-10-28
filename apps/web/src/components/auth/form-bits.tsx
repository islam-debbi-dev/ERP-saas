'use client';

import { Eye, EyeOff, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ComponentProps, type ReactNode, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type IconFieldProps = ComponentProps<'input'> & {
  id: string;
  label: string;
  icon: LucideIcon;
  error?: string;
  hint?: string;
  /** Button shown inside the input, at the end (e.g. show password). */
  end?: ReactNode;
};

/**
 * Label + input with a leading icon + hint or error, wired for screen readers.
 * For LTR content (email, password) the wrapper is LTR too, so the icon and its
 * padding stay on the same side in Arabic.
 */
export function IconField({
  id,
  label,
  icon: Icon,
  error,
  hint,
  end,
  dir,
  className,
  ...input
}: IconFieldProps) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative" dir={dir}>
        <Icon
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id={id}
          dir={dir}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn('ps-9', end ? 'pe-12 md:pe-10' : undefined, className)}
          {...input}
        />
        {end ? (
          <div className="absolute end-0 top-1/2 -translate-y-1/2 md:end-1.5">{end}</div>
        ) : null}
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Password input with a show/hide button inside the field. */
export function PasswordField(props: Omit<IconFieldProps, 'type' | 'end' | 'dir'>) {
  const t = useTranslations('auth');
  const [visible, setVisible] = useState(false);
  return (
    <IconField
      {...props}
      type={visible ? 'text' : 'password'}
      dir="ltr"
      end={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t('hidePassword') : t('showPassword')}
          aria-pressed={visible}
          className="flex size-11 items-center justify-center rounded md:size-8 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {visible ? (
            <EyeOff className="size-4" aria-hidden />
          ) : (
            <Eye className="size-4" aria-hidden />
          )}
        </button>
      }
    />
  );
}
