import { AdminLoginForm } from '@/components/admin/admin-login-form';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('admin.loginTitle');

export default function Page() {
  return <AdminLoginForm />;
}
