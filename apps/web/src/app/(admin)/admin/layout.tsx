import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin/admin-shell';

// Never indexed: the admin area is for the platform team only.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
