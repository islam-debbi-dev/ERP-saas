import { Feature } from '@erp/shared';
import { SellOutReport } from '@/components/distribution/sell-out-report';
import { FeatureGate } from '@/components/shared/feature-gate';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('sellOut.title');

export default function Page() {
  return (
    <FeatureGate feature={Feature.SALES_FORCE}>
      <SellOutReport />
    </FeatureGate>
  );
}
