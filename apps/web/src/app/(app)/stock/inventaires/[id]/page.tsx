import { InventoryCount } from '@/components/stock/inventory-count';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('stock.inventories');

export default async function InventoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InventoryCount id={id} />;
}
