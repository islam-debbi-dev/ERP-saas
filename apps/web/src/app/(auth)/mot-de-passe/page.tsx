import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ChangePasswordForm } from '@/components/auth/change-password-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('password');
  return { title: t('title') };
}

export default function ChangePasswordPage() {
  return <ChangePasswordForm />;
}
