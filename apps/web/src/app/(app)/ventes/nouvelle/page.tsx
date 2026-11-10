import { SaleScreenLoader } from '@/components/sales/sale-screen-loader';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('sales.newTitle');

export default async function NewSalePage({
  searchParams,
}: {
  searchParams: Promise<{ brouillon?: string; client?: string; clientId?: string }>;
}) {
  const { brouillon, clientId } = await searchParams;
  // ?clientId= is the dashboard's name (phase 33); ?client= the older links.
  const client = (await searchParams).client ?? clientId;
  // `key` remounts the screen when switching between drafts or a new sale.
  return (
    <SaleScreenLoader
      key={brouillon ?? `new:${client ?? ''}`}
      draftId={brouillon ?? null}
      clientId={client ?? null}
    />
  );
}
