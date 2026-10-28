import { AdminTenantPage } from '@/components/admin/admin-tenant-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('admin.tenants');

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminTenantPage id={id} />;
}
