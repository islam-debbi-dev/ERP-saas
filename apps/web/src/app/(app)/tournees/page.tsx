import { RoutesList } from '@/components/tournees/routes-list';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('tournees.title');

export default function TourneesPage() {
  return <RoutesList />;
}
