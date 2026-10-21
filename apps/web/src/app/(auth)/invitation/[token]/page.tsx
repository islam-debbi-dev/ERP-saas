import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AcceptInvitationForm } from '@/components/auth/accept-invitation-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('invitation');
  return { title: t('title') };
}

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <AcceptInvitationForm token={token} />;
}
