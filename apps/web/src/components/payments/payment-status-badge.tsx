'use client';

import { useTranslations } from 'next-intl';
import type { PaymentStatus } from '@erp/shared';
import { Badge } from '@/components/ui/badge';

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const t = useTranslations('sales');
  const variant =
    status === 'VALID' ? 'secondary' : status === 'BOUNCED' ? 'destructive' : 'outline';
  return <Badge variant={variant}>{t(`payment${status}`)}</Badge>;
}
