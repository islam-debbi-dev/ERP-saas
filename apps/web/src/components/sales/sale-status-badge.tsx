'use client';

import { useTranslations } from 'next-intl';
import type { SaleStatus } from '@erp/shared';
import { Badge } from '@/components/ui/badge';

export function SaleStatusBadge({ status }: { status: SaleStatus }) {
  const t = useTranslations('sales');
  const variant = status === 'VALIDATED' ? 'default' : status === 'DRAFT' ? 'secondary' : 'outline';
  return <Badge variant={variant}>{t(`status${status}`)}</Badge>;
}
