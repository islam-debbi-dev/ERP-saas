import { SuppliersManager } from '@/components/purchases/suppliers-manager';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('suppliers.title');

export default function SuppliersPage() {
  return <SuppliersManager />;
}
