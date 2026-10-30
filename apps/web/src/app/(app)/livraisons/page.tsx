import { DeliveriesList } from '@/components/tournees/deliveries-list';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('orders.deliveriesTitle');

export default function DeliveriesPage() {
  return <DeliveriesList />;
}
