import { ClientsMapScreen } from '@/components/geo/clients-map-screen';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('nav.clientsMap');

export default function ClientsMapPage() {
  return <ClientsMapScreen />;
}
