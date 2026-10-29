import { SectorsManager } from '@/components/sales-force/sectors-manager';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('sectors.title');

export default function SectorsPage() {
  return <SectorsManager />;
}
