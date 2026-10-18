import type { Metadata } from 'next';
import { LoginForm } from '@/components/auth/login-form';
import { t } from '@/lib/i18n';

export const metadata: Metadata = { title: t('auth.loginTitle') };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { expired } = await searchParams;
  return <LoginForm expired={expired === '1'} />;
}
