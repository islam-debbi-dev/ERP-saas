'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { TenantSettingsResponse } from '@erp/shared';
import { PageHeader } from '@/components/shared/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { usePriceLevels, useProduct, useUnits } from '@/lib/catalog';
import { useErrorMessage } from '@/lib/use-error-message';
import { ProductForm } from './product-form';

function useSettings() {
  return useQuery({
    queryKey: ['tenant-settings'],
    queryFn: () => api.request<TenantSettingsResponse>('/tenant/settings'),
  });
}

/** Loads what the form needs, then mounts it (remounted on each saved version). */
export function ProductEditor({ productId }: { productId: string | null }) {
  const t = useTranslations('products');
  const errorMessage = useErrorMessage();
  const units = useUnits();
  const levels = usePriceLevels();
  const settings = useSettings();
  const product = useProduct(productId ?? '');
  const productReady = productId === null || product.data !== undefined;

  const error = units.error ?? levels.error ?? settings.error ?? (productId ? product.error : null);
  const header = (
    <PageHeader
      title={productId ? (product.data?.designation ?? t('editTitle')) : t('newTitle')}
      actions={
        <Button asChild variant="ghost">
          <Link href="/produits">
            <ArrowLeft className="rtl-flip" aria-hidden />
            {t('back')}
          </Link>
        </Button>
      }
    />
  );

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
  if (!units.data || !levels.data || !settings.data || !productReady) {
    return (
      <>
        {header}
        <div className="grid gap-6" aria-busy>
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </>
    );
  }
  const loaded = productId ? (product.data ?? null) : null;
  return (
    <>
      {header}
      <ProductForm
        key={loaded ? `${loaded.id}:${loaded.version}` : 'new'}
        product={loaded}
        units={units.data}
        levels={levels.data}
        settings={settings.data}
      />
    </>
  );
}
