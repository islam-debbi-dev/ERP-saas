import { ClientsList } from '@/components/clients/clients-list';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('nav.clients');

export default function ClientsPage() {
  return <ClientsList />;
}
