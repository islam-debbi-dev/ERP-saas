import { OrderView } from '@/components/tournees/order-view';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('orders.deliveriesTitle');

export default async function DeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrderView id={id} backHref="/livraisons" />;
}
