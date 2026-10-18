import { ClientEditor } from '@/components/clients/client-editor';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('clients.editTitle');

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClientEditor clientId={id} />;
}
