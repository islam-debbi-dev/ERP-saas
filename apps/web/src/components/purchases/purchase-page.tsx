'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { type ProductDto, type PurchaseDto, qty, type TenantSettingsResponse } from '@erp/shared';
import { PageHeader } from '@/components/shared/page-header';
import { PrintButton } from '@/components/shared/print-button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { usePriceLevels } from '@/lib/catalog';
import { todayInAlgiers, usePurchase } from '@/lib/purchases';
import { useErrorMessage } from '@/lib/use-error-message';
import { type EditorLine, PurchaseEditor } from './purchase-editor';
import { PurchaseStatusBadge } from './purchase-status-badge';
import { PurchaseView } from './purchase-view';

/** Products of a draft's lines, so the editor can offer their units and prices. */
function useDraftProducts(purchase: PurchaseDto | undefined) {
  const ids =
    purchase?.status === 'DRAFT' ? [...new Set(purchase.lines.map((l) => l.productId))] : [];
  return useQuery({
    queryKey: ['purchase-products', purchase?.id, purchase?.version],
    queryFn: async () => {
      const products = await Promise.all(
        ids.map((id) => api.request<ProductDto>(`/products/${id}`)),
      );
      return new Map(products.map((p) => [p.id, p]));
    },
    enabled: purchase !== undefined,
  });
}

const uuid = z.uuid();
function linkedIds(params: { get(key: string): string | null }) {
  const valid = (v: string | null) => (v && uuid.safeParse(v).success ? v : '');
  return { supplierId: valid(params.get('supplierId')), productId: valid(params.get('productId')) };
}

export function PurchasePage({ id }: { id: string | null }) {
  const t = useTranslations('purchases');
  const errorMessage = useErrorMessage();
  const purchase = usePurchase(id ?? '');
  const params = useSearchParams();
  // A new BR opened from a dossier d'importation joins it (phase 22).
  const fromFile = params.get('dossier') ?? '';
  // Phase 33: "Commander" on the dashboard opens a new BR with the product and its usual
  // supplier (read once; the user still confirms). An invalid id is ignored.
  const prefill = id === null ? linkedIds(params) : { supplierId: '', productId: '' };
  const prefillProduct = useQuery({
    queryKey: ['products', prefill.productId],
    queryFn: () => api.request<ProductDto>(`/products/${prefill.productId}`),
    enabled: prefill.productId !== '',
  });
  const settings = useQuery({
    queryKey: ['tenant-settings'],
    queryFn: () => api.request<TenantSettingsResponse>('/tenant/settings'),
  });
  const levels = usePriceLevels();
  const products = useDraftProducts(purchase.data);

  const p = purchase.data;
  const header = (
    <PageHeader
      title={p ? (p.number ?? t('editTitle')) : t('newTitle')}
      actions={
        <>
          {p ? <PurchaseStatusBadge status={p.status} /> : null}
          {p && p.status !== 'DRAFT' ? <PrintButton path={`/documents/BR/${p.id}/pdf`} /> : null}
          <Button asChild variant="ghost">
            <Link href="/achats">
              <ArrowLeft className="rtl-flip" aria-hidden />
              {t('back')}
            </Link>
          </Button>
        </>
      }
    />
  );

  const error = purchase.error ?? settings.error ?? levels.error ?? products.error;
  if (error) {
    return (
      <>
        {header}
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(error)}</AlertDescription>
        </Alert>
      </>
    );
  }
  const loading =
    !settings.data ||
    !levels.data ||
    (id !== null && (!p || !products.data)) ||
    (prefill.productId !== '' && prefillProduct.isPending);
  if (loading) {
    return (
      <>
        {header}
        <div className="grid gap-6" aria-busy>
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </>
    );
  }
  if (p && p.status !== 'DRAFT') {
    return (
      <>
        {header}
        <PurchaseView purchase={p} />
      </>
    );
  }
  const linked = prefillProduct.data;
  const prefilled: EditorLine[] =
    !p && linked
      ? [
          {
            key: `prefill:${linked.id}`,
            product: linked,
            unitId: linked.units.find((u) => u.isDefaultPurchase)?.unitId ?? linked.baseUnitId,
            qty: '1',
            unitCost: '',
          },
        ]
      : [];
  const initialLines: EditorLine[] = (p?.lines ?? []).flatMap((l) => {
    const product = products.data?.get(l.productId);
    return product
      ? [
          {
            key: l.id,
            product,
            unitId: l.unitId,
            qty: qty(l.qty).toString(),
            // A foreign line is edited in the supplier's currency.
            unitCost: qty(l.unitCostCurrency ?? l.unitCost).toString(),
          },
        ]
      : [];
  });
  return (
    <>
      {header}
      <PurchaseEditor
        key={p ? `${p.id}:${p.version}` : 'new'}
        purchase={p ?? null}
        initialLines={p ? initialLines : prefilled}
        initialHeader={{
          supplierId: p?.supplier.id ?? prefill.supplierId,
          documentDate: p?.documentDate ?? todayInAlgiers(),
          supplierRef: p?.supplierRef ?? '',
          warehouseId: p?.warehouse?.id ?? '',
          note: p?.note ?? '',
          paidAmount: p && p.paidAmount !== '0.00' ? p.paidAmount : '',
          paidMode: p?.paidMode ?? 'ESPECES',
          paidCashAccountId: p?.paidCashAccount?.id ?? '',
          exchangeRate: p && p.currency !== 'DZD' ? p.exchangeRate : '',
          importFileId: p ? (p.importFile?.id ?? '') : fromFile,
        }}
        assujettiTva={settings.data.assujettiTva}
        levels={levels.data}
      />
    </>
  );
}
