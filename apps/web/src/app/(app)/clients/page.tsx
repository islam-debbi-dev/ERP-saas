import { Suspense } from 'react';
import { ClientsList } from '@/components/clients/clients-list';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('nav.clients');

export default function ClientsPage() {
  // ClientsList keeps its filters in the URL (useSearchParams needs a Suspense boundary).
  return (
    <Suspense>
      <ClientsList />
    </Suspense>
  );
}
