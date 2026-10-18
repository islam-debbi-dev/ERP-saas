import { SaleView } from '@/components/sales/sale-view';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('sales.detailTitle');

export default async function SalePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SaleView id={id} />;
}
