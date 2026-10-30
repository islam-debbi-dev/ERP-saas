import { VisitReport } from '@/components/tournees/visit-report';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('tournees.reportTitle');

export default function TourneeReportPage() {
  return <VisitReport />;
}
