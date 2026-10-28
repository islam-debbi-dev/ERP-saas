'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, LockKeyhole, LogIn, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { useErrorMessage } from '@/lib/use-error-message';
import { AuthCard } from './auth-card';
import { IconField, PasswordField } from './form-bits';

/** The API reads `identifier` as an email when it has an @, otherwise as a phone number. */
const formSchema = z.object({
  identifier: z.string().trim().min(1),
  password: z.string().min(1).max(128),
});
type FormValues = z.infer<typeof formSchema>;

export function LoginForm({ expired }: { expired: boolean }) {
  const t = useTranslations();
  const errorMessage = useErrorMessage();
  const { login, state } = useAuth();
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(
    expired ? t('auth.sessionExpired') : null,
  );
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { identifier: '', password: '' },
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
      setFormError(errorMessage(err));
    }
  });

  return (
    <AuthCard title={t('auth.loginTitle')} description={t('auth.loginDescription')}>
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
        {formError ? (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}
        <IconField
          id="identifier"
          label={t('auth.identifier')}
          icon={UserRound}
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          dir="ltr"
          autoFocus
          placeholder={t('auth.emailPlaceholder')}
          hint={t('auth.identifierHint')}
          error={errors.identifier && t('validation.required')}
          {...form.register('identifier')}
        />
        <PasswordField
          id="password"
          label={t('auth.password')}
          icon={LockKeyhole}
          autoComplete="current-password"
          error={errors.password && t('validation.required')}
          {...form.register('password')}
        />
        <Button type="submit" className="w-full gap-2" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="animate-spin" aria-hidden /> : <LogIn aria-hidden />}
          {isSubmitting ? t('auth.loggingIn') : t('auth.login')}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          {t('auth.noAccount')}{' '}
          <Link
            href="/inscription"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('auth.createCompany')}
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
