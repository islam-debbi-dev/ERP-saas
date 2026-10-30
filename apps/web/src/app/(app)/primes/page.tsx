import { IncentivesHome } from '@/components/incentives/incentives-home';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('incentives.title');

export default function IncentivesPage() {
  return <IncentivesHome />;
}
