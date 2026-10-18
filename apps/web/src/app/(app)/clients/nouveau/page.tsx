import { ClientEditor } from '@/components/clients/client-editor';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('clients.newTitle');

export default function NewClientPage() {
  return <ClientEditor clientId={null} />;
}
