import { SaleScreenLoader } from '@/components/sales/sale-screen-loader';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('sales.newTitle');

export default async function NewSalePage({
  searchParams,
}: {
  searchParams: Promise<{ brouillon?: string; client?: string }>;
}) {
  const { brouillon, client } = await searchParams;
  // `key` remounts the screen when switching between drafts or a new sale.
  return (
    <SaleScreenLoader
      key={brouillon ?? `new:${client ?? ''}`}
      draftId={brouillon ?? null}
      clientId={client ?? null}
    />
  );
}
