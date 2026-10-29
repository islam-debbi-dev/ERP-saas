import { SupplierDetail } from '@/components/purchases/supplier-detail';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('supplierAccount.title');

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SupplierDetail supplierId={id} />;
}
