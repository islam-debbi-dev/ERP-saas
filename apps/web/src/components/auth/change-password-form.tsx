'use client';

import { KeyRound, Loader2, LockKeyhole } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { AuthUser } from '@erp/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { useErrorMessage } from '@/lib/use-error-message';
import { AuthCard } from './auth-card';
import { PasswordField } from './form-bits';

/** First login with a temporary password: nothing else works until it is changed. */
export function ChangePasswordForm() {
  const t = useTranslations();
  const errorMessage = useErrorMessage();
  const { state, updateUser, logout } = useAuth();
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state.status === 'anonymous') router.replace('/login');
  }, [state.status, router]);

  const submit = async () => {
    setError(null);
    if (next.length < 8) return setError(t('validation.passwordMin'));
    if (next !== confirm) return setError(t('password.mismatch'));
    setBusy(true);
    try {
      const user = await api.request<AuthUser>('/auth/password', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next },
      });
      updateUser(user);
      router.replace('/tableau-de-bord');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title={t('password.title')} description={t('password.description')}>
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <PasswordField
          id="current-password"
          label={t('password.current')}
          icon={LockKeyhole}
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <PasswordField
          id="new-password"
          label={t('password.new')}
          icon={KeyRound}
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <PasswordField
          id="confirm-password"
          label={t('password.confirm')}
          icon={KeyRound}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {t('password.submit')}
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={() => void logout()}>
          {t('nav.logout')}
        </Button>
      </form>
    </AuthCard>
  );
}
