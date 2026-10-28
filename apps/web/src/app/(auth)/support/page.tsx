import { SupportLanding } from '@/components/billing/support-landing';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('support.title');

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ended } = await searchParams;
  return <SupportLanding ended={ended === '1'} />;
}
