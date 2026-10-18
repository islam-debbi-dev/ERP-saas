'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { type LoginInput, loginSchema } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import { messageFor } from '@/lib/form-errors';
import { t } from '@/lib/i18n';

export function LoginForm({ expired }: { expired: boolean }) {
  const { login, state } = useAuth();
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(
    expired ? t('auth.sessionExpired') : null,
  );
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    if (state.status === 'authenticated') router.replace('/tableau-de-bord');
  }, [state.status, router]);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login(values);
    } catch (err) {
      setFormError(messageFor(err));
    }
  });

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t('auth.loginTitle')}</h1>
      <p className="mt-1.5 text-muted-foreground">{t('auth.loginSubtitle')}</p>

      <form onSubmit={(e) => void onSubmit(e)} noValidate className="mt-8 flex flex-col gap-5">
        {formError ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            {formError}
          </p>
        ) : null}
        <Field id="email" label={t('auth.email')} error={errors.email && t('validation.email')}>
          <Input
            {...fieldAria('email', errors.email?.message)}
            type="email"
            autoComplete="email"
            inputMode="email"
            autoFocus
            {...form.register('email')}
          />
        </Field>
        <Field
          id="password"
          label={t('auth.password')}
          error={errors.password && t('validation.required')}
        >
          <Input
            {...fieldAria('password', errors.password?.message)}
            type="password"
            autoComplete="current-password"
            {...form.register('password')}
          />
        </Field>
        <Button type="submit" disabled={isSubmitting} className="mt-1">
          {isSubmitting ? t('auth.loggingIn') : t('auth.login')}
        </Button>
      </form>

      <p className="mt-8 text-sm text-muted-foreground">
        {t('auth.noAccount')}{' '}
        <Link href="/inscription" className="font-medium text-primary hover:underline">
          {t('auth.createCompany')}
        </Link>
      </p>
    </>
  );
}
