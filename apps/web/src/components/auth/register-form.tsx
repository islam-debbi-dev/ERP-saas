'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Building2, Loader2, LockKeyhole, Mail, Ship, Store, Truck, UserRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { type z } from 'zod';
import { ACTIVITIES, type Activity, type RegisterInput, registerSchema } from '@erp/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { useErrorMessage } from '@/lib/use-error-message';
import { AuthCard } from './auth-card';
import { IconField, PasswordField } from './form-bits';

const ACTIVITY_ICONS: Record<Activity, LucideIcon> = {
  GROSSISTE: Store,
  IMPORTATEUR: Ship,
  DISTRIBUTEUR: Truck,
};

export function RegisterForm() {
  const t = useTranslations();
  const errorMessage = useErrorMessage();
  const { register: registerCompany } = useAuth();
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.input<typeof registerSchema>, unknown, RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      companyName: '',
      fullName: '',
      email: '',
      password: '',
      activity: 'GROSSISTE',
    },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await registerCompany(values);
      router.replace('/tableau-de-bord');
    } catch (err) {
      setFormError(errorMessage(err));
    }
  });

  return (
    <AuthCard title={t('auth.registerTitle')} description={t('auth.registerDescription')}>
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
        {formError ? (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}
        <IconField
          id="companyName"
          label={t('auth.companyName')}
          icon={Building2}
          autoComplete="organization"
          autoFocus
          hint={t('auth.companyNameHint')}
          error={errors.companyName && t('validation.tooShort')}
          {...form.register('companyName')}
        />
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('auth.activity')}</legend>
          <p className="text-xs text-muted-foreground">{t('auth.activityHint')}</p>
          <div className="grid gap-2">
            {ACTIVITIES.map((a) => {
              const Icon = ACTIVITY_ICONS[a];
              return (
                <label
                  key={a}
                  className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 text-start transition-colors hover:bg-accent/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50"
                >
                  <input
                    type="radio"
                    value={a}
                    className="mt-1 size-4 shrink-0 accent-primary"
                    {...form.register('activity')}
                  />
                  <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 space-y-0.5">
                    <span className="block text-sm font-medium">{t(`features.activity${a}`)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t(`features.activity${a}Help`)}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <IconField
          id="fullName"
          label={t('auth.fullName')}
          icon={UserRound}
          autoComplete="name"
          error={errors.fullName && t('validation.tooShort')}
          {...form.register('fullName')}
        />
        <IconField
          id="email"
          label={t('auth.email')}
          icon={Mail}
          type="email"
          inputMode="email"
          autoComplete="email"
          dir="ltr"
          placeholder={t('auth.emailPlaceholder')}
          error={errors.email && t('validation.email')}
          {...form.register('email')}
        />
        <PasswordField
          id="password"
          label={t('auth.password')}
          icon={LockKeyhole}
          autoComplete="new-password"
          hint={t('auth.passwordHint')}
          error={errors.password && t('validation.passwordMin')}
          {...form.register('password')}
        />
        <Button type="submit" className="w-full gap-2" disabled={isSubmitting}>
          {isSubmitting ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Building2 aria-hidden />
          )}
          {isSubmitting ? t('auth.registering') : t('auth.register')}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          {t('auth.haveAccount')}{' '}
          <Link
            href="/login"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('auth.goToLogin')}
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
