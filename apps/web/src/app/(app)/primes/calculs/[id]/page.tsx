import { RunView } from '@/components/incentives/run-view';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('incentives.runPageTitle');

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RunView id={id} />;
}
