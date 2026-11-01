'use client';

import { useTranslations } from 'next-intl';
import type { ImportFileStatus } from '@erp/shared';
import { Badge } from '@/components/ui/badge';

export function ImportFileStatusBadge({ status }: { status: ImportFileStatus }) {
  const t = useTranslations('importFiles');
  const variant = status === 'CLOSED' ? 'default' : status === 'OPEN' ? 'secondary' : 'outline';
  return <Badge variant={variant}>{t(`status${status}`)}</Badge>;
}
