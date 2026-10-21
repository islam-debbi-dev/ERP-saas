import { AuditPage } from '@/components/users/audit-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('audit.title');

export default function Page() {
  return <AuditPage />;
}
