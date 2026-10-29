import { AgingReport } from '@/components/reports/aging-report';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('aging.title');

export default function AgingPage() {
  return <AgingReport />;
}
