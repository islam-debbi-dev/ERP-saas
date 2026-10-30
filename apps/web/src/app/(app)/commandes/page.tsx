import { OrdersList } from '@/components/tournees/orders-list';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('orders.title');

export default function OrdersPage() {
  return <OrdersList />;
}
