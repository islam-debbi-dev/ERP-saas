'use client';

import { useTranslations } from 'next-intl';
import type { OrderStatus } from '@erp/shared';
import { Badge } from '@/components/ui/badge';

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const t = useTranslations('orders');
  const variant =
    status === 'CONFIRMED' ? 'default' : status === 'DELIVERED' ? 'secondary' : 'outline';
  return (
    <Badge variant={variant} className={status === 'CANCELLED' ? 'text-muted-foreground' : ''}>
      {t(`status${status}`)}
    </Badge>
  );
}
