'use client';

import { useQuery } from '@tanstack/react-query';
import { KeyRound, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { AuthResponse, InvitationInfoDto } from '@erp/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { useErrorMessage } from '@/lib/use-error-message';
import { AuthCard } from './auth-card';
import { PasswordField } from './form-bits';

/** The one-time link from the owner: the employee picks his password and is logged in. */
export function AcceptInvitationForm({ token }: { token: string }) {
  const t = useTranslations();
  const errorMessage = useErrorMessage();
  const { acceptAuth } = useAuth();
  const router = useRouter();
  const info = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api.request<InvitationInfoDto>(`/auth/invitations/${encodeURIComponent(token)}`),
    retry: false,
  });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (password.length < 8) return setError(t('validation.passwordMin'));
    if (password !== confirm) return setError(t('password.mismatch'));
    setBusy(true);
    try {
      const auth = await api.request<AuthResponse>(
        `/auth/invitations/${encodeURIComponent(token)}/accept`,
        { method: 'POST', body: { password, deviceName: 'Web' } },
      );
      acceptAuth(auth);
      router.replace('/tableau-de-bord');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (info.isPending) return <Skeleton className="h-64 w-full" />;
  if (info.isError) {
    return (
      <AuthCard title={t('invitation.title')} description="">
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(info.error)}</AlertDescription>
        </Alert>
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title={t('invitation.welcome', { name: info.data.fullName })}
      description={t('invitation.description', { company: info.data.tenantName })}
    >
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
          id="invite-new-password"
          label={t('password.new')}
          icon={KeyRound}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <PasswordField
          id="invite-confirm-password"
          label={t('password.confirm')}
          icon={KeyRound}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {t('invitation.submit')}
        </Button>
      </form>
    </AuthCard>
  );
}
