import { VehicleTypesPage } from '@/components/vehicles/vehicle-types-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('vehicleTypes.title');

export default function VehicleTypesRoute() {
  return <VehicleTypesPage />;
}
