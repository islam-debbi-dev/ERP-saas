import { FlaggedOperations } from '@/components/geo/flagged-operations';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('geo.title');

export default function FlaggedOperationsPage() {
  return <FlaggedOperations />;
}
