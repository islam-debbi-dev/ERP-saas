import { Feature } from '@erp/shared';
import { PromotionsPage } from '@/components/distribution/promotions-page';
import { FeatureGate } from '@/components/shared/feature-gate';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('promotions.title');

export default function Page() {
  return (
    <FeatureGate feature={Feature.PROMOTIONS}>
      <PromotionsPage />
    </FeatureGate>
  );
}
