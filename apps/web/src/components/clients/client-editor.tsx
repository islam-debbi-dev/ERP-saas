'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/shared/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { usePriceLevels } from '@/lib/catalog';
import { useClient } from '@/lib/clients';
import { useErrorMessage } from '@/lib/use-error-message';
import { ClientForm } from './client-form';

/** Loads what the form needs, then mounts it (remounted on each saved version). */
export function ClientEditor({ clientId }: { clientId: string | null }) {
  const t = useTranslations('clients');
  const errorMessage = useErrorMessage();
  const levels = usePriceLevels();
  const client = useClient(clientId ?? '');
  const error = levels.error ?? (clientId ? client.error : null);
  const back = clientId ? `/clients/${clientId}` : '/clients';

  const header = (
    <PageHeader
      title={clientId ? (client.data?.name ?? t('editTitle')) : t('newTitle')}
      actions={
        <Button asChild variant="ghost">
          <Link href={back}>
            <ArrowLeft className="rtl-flip" aria-hidden />
            {t('back')}
          </Link>
        </Button>
      }
    />
  );
  if (error) {
    return (
      <>
        {header}
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(error)}</AlertDescription>
        </Alert>
      </>
    );
  }
  if (!levels.data || (clientId && !client.data)) {
    return (
      <>
        {header}
        <Skeleton className="h-96 w-full" aria-busy />
      </>
    );
  }
  const loaded = clientId ? (client.data ?? null) : null;
  return (
    <>
      {header}
      <ClientForm
        key={loaded ? `${loaded.id}:${loaded.version}` : 'new'}
        client={loaded}
        levels={levels.data}
      />
    </>
  );
}
