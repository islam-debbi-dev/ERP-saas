import { BrandsManager } from '@/components/sales-force/brands-manager';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('brands.title');

export default function BrandsPage() {
  return <BrandsManager />;
}
