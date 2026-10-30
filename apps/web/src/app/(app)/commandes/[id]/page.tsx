import { OrderView } from '@/components/tournees/order-view';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('orders.orderOne');

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrderView id={id} />;
}
