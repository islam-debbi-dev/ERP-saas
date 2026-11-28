'use client';

import { ArrowLeft, CircleCheck, Loader2, MapPin, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Permission } from '@erp/shared';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth, usePermission } from '@/lib/auth';
import { clientOldText } from '@/lib/locations';
import { useErrorMessage } from '@/lib/use-error-message';
import { leadsOrOffice, useClientsWithoutCommune } from '@/lib/zones';

/** Clients with no commune (phase 40b): each row opens the client form at the location. */
export function WithoutCommuneList() {
  const role = useAuth().state.user?.role;
  const tn = useTranslations('nav');
  if (!leadsOrOffice(role)) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title={tn('forbiddenTitle')}
        description={tn('forbiddenBody')}
      />
    );
  }
  return <List />;
}

function List() {
  const t = useTranslations('withoutCommune');
  const errorMessage = useErrorMessage();
  const canEdit = usePermission(Permission.CLIENTS_EDIT);
  const pages = useClientsWithoutCommune();
  const total = pages.data?.pages[0]?.total;
  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader
        title={total === undefined ? t('title') : t('titleCount', { count: total })}
        description={t('help')}
        more={[
          { label: t('back'), icon: ArrowLeft, flipIcon: true, tone: 'ghost', href: '/clients' },
        ]}
      />
      {pages.isPending ? (
        <div className="space-y-3" aria-busy>
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : pages.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(pages.error)}
        </p>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState icon={CircleCheck} title={t('empty')} />
        </Card>
      ) : (
        <ul className="grid gap-3">
          {items.map((c) => {
            const old = clientOldText(c);
            return (
              <li key={c.id}>
                <Card
                  data-testid="without-commune-row"
                  className="gap-3 p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <p dir="auto" className="font-medium break-words">
                      {c.name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      <bdi dir="ltr">{c.code}</bdi>
                      {c.assignedSeller ? ` · ${c.assignedSeller.fullName}` : ''}
                    </p>
                    {old ? (
                      <p className="text-sm break-words text-muted-foreground">
                        {t('oldText')} <bdi>{old}</bdi>
                      </p>
                    ) : null}
                  </div>
                  <Button asChild variant="outline" className="min-h-11 shrink-0">
                    <Link
                      href={
                        canEdit ? `/clients/${c.id}/modifier?champ=commune` : `/clients/${c.id}`
                      }
                      aria-label={t(canEdit ? 'fixNamed' : 'openNamed', { name: c.name })}
                    >
                      <MapPin aria-hidden />
                      {t(canEdit ? 'fix' : 'open')}
                    </Link>
                  </Button>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      {pages.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            disabled={pages.isFetchingNextPage}
            onClick={() => void pages.fetchNextPage()}
          >
            {pages.isFetchingNextPage ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t('loadMore')}
          </Button>
        </div>
      ) : null}
    </>
  );
}
