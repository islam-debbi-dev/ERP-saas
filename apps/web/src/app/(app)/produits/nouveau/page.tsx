import { titled } from '@/lib/page-metadata';
import { ProductEditor } from '@/components/products/product-editor';

export const generateMetadata = titled('products.newTitle');

export default function NewProductPage() {
  return <ProductEditor productId={null} />;
}
