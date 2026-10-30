import { WarehousesManager } from '@/components/stock/warehouses-manager';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('warehouses.title');

export default function WarehousesPage() {
  return <WarehousesManager />;
}
