import { t, type MessageKey } from '@/lib/i18n';
import { PageHeader } from './page-header';

/** Placeholder for modules built in later phases. */
export function ComingSoon({ title }: { title: MessageKey }) {
  return (
    <>
      <PageHeader title={t(title)} />
      <p className="max-w-xl rounded-md border border-dashed bg-card px-4 py-6 text-muted-foreground">
        {t('common.comingSoon')}
      </p>
    </>
  );
}
