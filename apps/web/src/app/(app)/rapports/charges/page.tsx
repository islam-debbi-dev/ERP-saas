import { ChargesReport } from '@/components/reports/charges-report';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('charges.title');

export default function ChargesPage() {
  return <ChargesReport />;
}
