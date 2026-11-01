import { Feature } from '@erp/shared';
import { PackagingTypesManager } from '@/components/distribution/packaging-types-manager';
import { FeatureGate } from '@/components/shared/feature-gate';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('packaging.title');

export default function Page() {
  return (
    <FeatureGate feature={Feature.PACKAGING}>
      <PackagingTypesManager />
    </FeatureGate>
  );
}
