import { PurchasePage } from '@/components/purchases/purchase-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('purchases.editTitle');

export default async function PurchaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PurchasePage id={id} />;
}
