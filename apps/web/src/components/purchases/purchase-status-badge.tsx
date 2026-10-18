'use client';

import { useTranslations } from 'next-intl';
import type { PurchaseStatus } from '@erp/shared';
import { Badge } from '@/components/ui/badge';

export function PurchaseStatusBadge({ status }: { status: PurchaseStatus }) {
  const t = useTranslations('purchases');
  const variant = status === 'VALIDATED' ? 'default' : status === 'DRAFT' ? 'secondary' : 'outline';
  return <Badge variant={variant}>{t(`status${status}`)}</Badge>;
}
