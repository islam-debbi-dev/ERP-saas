import { SubscriptionPage } from '@/components/billing/subscription-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('billing.title');

export default function Page() {
  return <SubscriptionPage />;
}
