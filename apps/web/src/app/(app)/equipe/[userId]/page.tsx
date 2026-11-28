import { MemberZonePage } from '@/components/zones/member-zone-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('memberZone.title');

export default async function Page({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return <MemberZonePage userId={userId} />;
}
