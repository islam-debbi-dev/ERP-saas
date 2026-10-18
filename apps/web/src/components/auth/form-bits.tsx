'use client';

import { Eye, EyeOff, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ComponentProps, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Label + input with a leading icon + hint or error, wired for screen readers. */
export function IconField({
  id,
  label,
  icon: Icon,
  error,
  hint,
  ...input
}: ComponentProps<'input'> & {
  id: string;
  label: string;
  icon: LucideIcon;
  error?: string;
  hint?: string;
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Icon
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="ps-9"
          {...input}
        />
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

/** Password input with a show/hide button. */
export function PasswordField(
  props: Omit<ComponentProps<typeof IconField>, 'type'> & { icon: LucideIcon },
) {
  const t = useTranslations('auth');
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <IconField {...props} type={visible ? 'text' : 'password'} dir="ltr" className="px-9" />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t('hidePassword') : t('showPassword')}
        title={visible ? t('hidePassword') : t('showPassword')}
        className="absolute end-2 top-[2.125rem] rounded p-1.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {visible ? (
          <EyeOff className="size-4" aria-hidden />
        ) : (
          <Eye className="size-4" aria-hidden />
        )}
      </button>
    </div>
  );
}
