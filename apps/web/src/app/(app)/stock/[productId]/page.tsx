import { StockCard } from '@/components/stock/stock-card';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('nav.stock');

export default async function StockCardPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  return <StockCard productId={productId} />;
}
