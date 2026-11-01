import { WarehouseDetail } from '@/components/stock/warehouse-detail';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('warehouses.title');

export default async function WarehousePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WarehouseDetail id={id} />;
}
