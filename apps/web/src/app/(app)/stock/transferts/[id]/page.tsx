import { TransferEntry } from '@/components/stock/transfer-entry';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('transfers.title');

export default async function TransferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TransferEntry id={id} />;
}
