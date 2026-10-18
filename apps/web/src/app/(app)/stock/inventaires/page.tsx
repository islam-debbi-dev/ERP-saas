import { InventoriesList } from '@/components/stock/inventories-list';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('stock.inventories');

export default function InventoriesPage() {
  return <InventoriesList />;
}
