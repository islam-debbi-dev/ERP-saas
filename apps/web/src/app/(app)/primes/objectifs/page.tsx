import { TargetsGrid } from '@/components/incentives/targets-grid';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('incentives.targetsTitle');

export default function TargetsPage() {
  return <TargetsGrid />;
}
