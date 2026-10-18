'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { money, type ProductDto } from '@erp/shared';
import { PageHeader } from '@/components/shared/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { usePriceLevels } from '@/lib/catalog';
import { useClient } from '@/lib/clients';
import { useSale } from '@/lib/sales';
import { useTenantSettings } from '@/lib/settings';
import { useErrorMessage } from '@/lib/use-error-message';
import { type ScreenLine, SaleScreen } from './sale-screen';

/** Loads what the screen needs (and the draft to resume, if any), then mounts it. */
export function SaleScreenLoader({ draftId }: { draftId: string | null }) {
  const t = useTranslations('sales');
  const errorMessage = useErrorMessage();
  const settings = useTenantSettings();
  const levels = usePriceLevels();
  const draft = useSale(draftId ?? '');
  const client = useClient(draft.data?.client?.id ?? '');
  const productIds = [...new Set(draft.data?.lines.map((l) => l.productId) ?? [])];
  const products = useQuery({
    queryKey: ['sale-draft-products', draftId, productIds],
    queryFn: () => Promise.all(productIds.map((id) => api.request<ProductDto>(`/products/${id}`))),
    enabled: draft.data !== undefined,
  });

  const error =
    settings.error ?? levels.error ?? (draftId ? (draft.error ?? products.error) : null);
  if (error) {
    return (
      <>
        <PageHeader title={t('newTitle')} />
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(error)}</AlertDescription>
        </Alert>
      </>
    );
  }
  const draftClientId = draft.data?.client?.id;
  const ready =
    settings.data &&
    levels.data &&
    (!draftId || (draft.data && products.data && (!draftClientId || client.data)));
  if (!ready || !settings.data || !levels.data) {
    return (
      <>
        <PageHeader title={t('newTitle')} />
        <Skeleton className="h-96 w-full" aria-busy />
      </>
    );
  }
  if (draft.data && draft.data.status !== 'DRAFT') {
    return (
      <>
        <PageHeader title={t('draftTitle')} />
        <Alert role="status">
          <AlertDescription>{t('notADraft')}</AlertDescription>
        </Alert>
      </>
    );
  }
  const byId = new Map((products.data ?? []).map((p) => [p.id, p]));
  const lines: ScreenLine[] = (draft.data?.lines ?? []).flatMap((l) => {
    const product = byId.get(l.productId);
    if (!product) return [];
    const typed = l.listPriceHt === null || l.listPriceHt !== l.unitPriceHt;
    return [
      {
        key: l.id,
        product,
        unitId: l.unitId,
        qty: l.qty,
        price: typed ? l.unitPriceHt : null,
        discount: money(l.discountPct).toString(),
      },
    ];
  });
  return (
    <SaleScreen
      key={draft.data ? `${draft.data.id}:${draft.data.version}` : 'new'}
      draft={draft.data ?? null}
      initialLines={lines}
      initialClient={draftClientId ? (client.data ?? null) : null}
      levels={levels.data}
      settings={settings.data}
    />
  );
}
