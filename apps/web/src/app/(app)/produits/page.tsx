import { titled } from '@/lib/page-metadata';
import { ProductsList } from '@/components/products/products-list';

export const generateMetadata = titled('nav.products');

export default function ProductsPage() {
  return <ProductsList />;
}
