'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { type RegisterInput, registerSchema } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import { messageFor } from '@/lib/form-errors';
import { t } from '@/lib/i18n';

export function RegisterForm() {
  const { register: registerCompany } = useAuth();
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { companyName: '', fullName: '', email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await registerCompany(values);
      router.replace('/tableau-de-bord');
    } catch (err) {
      setFormError(messageFor(err));
    }
  });

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t('auth.registerTitle')}</h1>
      <p className="mt-1.5 text-muted-foreground">{t('auth.registerSubtitle')}</p>

      <form onSubmit={(e) => void onSubmit(e)} noValidate className="mt-8 flex flex-col gap-5">
        {formError ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            {formError}
          </p>
        ) : null}
        <Field
          id="companyName"
          label={t('auth.companyName')}
          hint={t('auth.companyNameHint')}
          error={errors.companyName && t('validation.tooShort')}
        >
          <Input
            {...fieldAria('companyName', errors.companyName?.message, 'hint')}
            autoComplete="organization"
            autoFocus
            {...form.register('companyName')}
          />
        </Field>
        <Field
          id="fullName"
          label={t('auth.fullName')}
          error={errors.fullName && t('validation.tooShort')}
        >
          <Input
            {...fieldAria('fullName', errors.fullName?.message)}
            autoComplete="name"
            {...form.register('fullName')}
          />
        </Field>
        <Field id="email" label={t('auth.email')} error={errors.email && t('validation.email')}>
          <Input
            {...fieldAria('email', errors.email?.message)}
            type="email"
            autoComplete="email"
            inputMode="email"
            {...form.register('email')}
          />
        </Field>
        <Field
          id="password"
          label={t('auth.password')}
          hint={t('auth.passwordHint')}
          error={errors.password && t('validation.passwordMin')}
        >
          <Input
            {...fieldAria('password', errors.password?.message, 'hint')}
            type="password"
            autoComplete="new-password"
            {...form.register('password')}
          />
        </Field>
        <Button type="submit" disabled={isSubmitting} className="mt-1">
          {isSubmitting ? t('auth.registering') : t('auth.register')}
        </Button>
      </form>

      <p className="mt-8 text-sm text-muted-foreground">
        {t('auth.haveAccount')}{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          {t('auth.goToLogin')}
        </Link>
      </p>
    </>
  );
}
