import { titled } from '@/lib/page-metadata';
import { ProductEditor } from '@/components/products/product-editor';

export const generateMetadata = titled('products.editTitle');

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductEditor productId={id} />;
}
