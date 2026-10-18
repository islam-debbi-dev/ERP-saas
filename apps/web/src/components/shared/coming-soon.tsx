import { Hourglass } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import type { NavKey } from '@/components/layout/navigation';
import { EmptyState } from './empty-state';
import { PageHeader } from './page-header';

/** Placeholder for modules built in later phases. */
export async function ComingSoon({ title }: { title: NavKey }) {
  const t = await getTranslations();
  return (
    <>
      <PageHeader title={t(`nav.${title}`)} />
      <Card>
        <EmptyState
          icon={Hourglass}
          title={t('common.comingSoonTitle')}
          description={t('common.comingSoon')}
        />
      </Card>
    </>
  );
}
