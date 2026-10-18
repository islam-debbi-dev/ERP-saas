import { ClientDetail } from '@/components/clients/client-detail';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('clients.detailTitle');

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClientDetail clientId={id} />;
}
