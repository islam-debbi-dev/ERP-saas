'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Feature } from '@erp/shared';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { useOrderPages } from '@/lib/tournees';
import { useErrorMessage } from '@/lib/use-error-message';
import { OrderCards } from './orders-list';

/** Livraisons (phase 16): the confirmed orders put on me, to deliver. */
export function DeliveriesList() {
  return (
    <FeatureGate feature={Feature.TOURNEES}>
      <Deliveries />
    </FeatureGate>
  );
}

function Deliveries() {
  const t = useTranslations('orders');
  const errorMessage = useErrorMessage();
  const me = useAuth().state.user?.id ?? '';
  // The API already limits a livreur to his orders; the filter also fits a seller.
  const pages = useOrderPages({ status: 'CONFIRMED', livreurId: me });
  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader title={t('deliveriesTitle')} description={t('deliveriesSubtitle')} />
      <OrderCards
        items={items}
        pending={pages.isPending}
        error={pages.isError ? errorMessage(pages.error) : null}
        hrefOf={(o) => `/livraisons/${o.id}`}
        emptyTitle={t('deliveriesEmptyTitle')}
        emptyDescription={t('deliveriesEmptyDescription')}
      />
      {pages.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => void pages.fetchNextPage()}
            disabled={pages.isFetchingNextPage}
          >
            {pages.isFetchingNextPage ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t('loadMore')}
          </Button>
        </div>
      ) : null}
    </>
  );
}
