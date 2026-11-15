import { Suspense } from 'react';
import { VehiclesPage } from '@/components/vehicles/vehicles-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('vehicles.title');

export default function VehiclesRoute() {
  // The page reads `?vehicle=` (a link from a worker's vehicle history).
  return (
    <Suspense>
      <VehiclesPage />
    </Suspense>
  );
}
