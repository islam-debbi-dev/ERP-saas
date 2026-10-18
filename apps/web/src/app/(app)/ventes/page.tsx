import { SalesList } from '@/components/sales/sales-list';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('nav.sales');

export default function SalesPage() {
  return <SalesList />;
}
