import { AdminRateSetsPage } from '@/components/admin/admin-rate-sets-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('admin.rateSets');

export default function Page() {
  return <AdminRateSetsPage />;
}
