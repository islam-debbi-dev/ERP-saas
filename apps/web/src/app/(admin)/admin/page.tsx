import { AdminTenantsPage } from '@/components/admin/admin-tenants-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('admin.tenants');

export default function Page() {
  return <AdminTenantsPage />;
}
