import { PlanEditor } from '@/components/incentives/plan-editor';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('incentives.planTitle');

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlanEditor id={id} />;
}
