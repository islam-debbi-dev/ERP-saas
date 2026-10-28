'use client';

import { KeyRound, Loader2, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { ErrorCode } from '@erp/shared';
import { IconField, PasswordField } from '@/components/auth/form-bits';
import { AuthCard } from '@/components/auth/auth-card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';
import { useAdminAuth } from '@/lib/admin';
import { useErrorMessage } from '@/lib/use-error-message';

/**
 * Two steps on one screen: email and password, then the 6-digit code of the
 * authenticator app. Both go to the API together, so a wrong password never tells
 * whether the code was right.
 */
export function AdminLoginForm() {
  const t = useTranslations();
  const errorMessage = useErrorMessage();
  const { login } = useAdminAuth();
  const [step, setStep] = useState<'password' | 'code'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError(t('validation.required'));
      return;
    }
    setError(null);
    setStep('code');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login({ email: email.trim().toLowerCase(), password, code: code.trim() });
    } catch (err) {
      setError(errorMessage(err));
      setCode('');
      // A wrong password (or a lock) sends back to the first step.
      if (!(err instanceof ApiError) || err.code !== ErrorCode.ADMIN_TOTP_INVALID) {
        setStep('password');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title={t('admin.loginTitle')} description={t('admin.loginSubtitle')}>
      {step === 'password' ? (
        <form onSubmit={next} className="space-y-4" noValidate>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <IconField
            id="admin-email"
            label={t('admin.email')}
            icon={Mail}
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            dir="ltr"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <PasswordField
            id="admin-password"
            label={t('admin.password')}
            icon={LockKeyhole}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" className="w-full gap-2">
            <KeyRound aria-hidden />
            {t('admin.next')}
          </Button>
        </form>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <IconField
            id="admin-code"
            label={t('admin.code')}
            icon={ShieldCheck}
            hint={t('admin.codeHelp')}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            dir="ltr"
            autoFocus
            className="num tracking-[0.3em]"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
          <Button type="submit" className="w-full gap-2" disabled={busy || code.length !== 6}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <ShieldCheck aria-hidden />}
            {t('admin.signIn')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              setStep('password');
              setError(null);
            }}
          >
            {t('admin.back')}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
