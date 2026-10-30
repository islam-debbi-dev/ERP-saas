import { TransfersList } from '@/components/stock/transfers-list';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('transfers.title');

export default function TransfersPage() {
  return <TransfersList />;
}
