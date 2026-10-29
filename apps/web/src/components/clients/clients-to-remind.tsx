'use client';

import { ArrowLeft, BellRing, Loader2, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { addDays, type ClientToRemindDto, formatDA, whatsappUrl } from '@erp/shared';
import { Amount } from '@/components/shared/amount';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCanManageCredit } from '@/lib/clients';
import { createShareLink, useClientsToRemind, whatsappShareUrl } from '@/lib/credit';
import { todayInAlgiers } from '@/lib/purchases';
import { useTenantSettings } from '@/lib/settings';
import { useErrorMessage } from '@/lib/use-error-message';
import { isolateLtr } from '@/lib/utils';

/** Clients à relancer (phase 21): who owes, for how long, and a WhatsApp reminder. */
export function ClientsToRemind() {
  const t = useTranslations('reminders');
  const errorMessage = useErrorMessage();
  const canManage = useCanManageCredit();
  const list = useClientsToRemind();
  const settings = useTenantSettings();
  const [sending, setSending] = useState<string | null>(null);

  const remind = async (item: ClientToRemindDto) => {
    // Open the tab inside the click: a tab opened after an await is blocked on phones.
    const tab = window.open('', '_blank');
    setSending(item.client.id);
    try {
      const today = todayInAlgiers();
      // The relevé starts at the oldest unpaid document (a year at most).
      const yearAgo = addDays(today, -365);
      const link = await createShareLink({
        docType: 'RELEVE',
        docId: item.client.id,
        from: item.oldestDate < yearAgo ? yearAgo : item.oldestDate,
        to: today,
      });
      const text = t('message', {
        name: item.client.name,
        company: settings.data?.raisonSociale ?? '',
        balance: isolateLtr(formatDA(item.balance)),
        days: item.oldestDays,
        url: link.url,
      });
      const url =
        (item.client.phone && whatsappUrl(item.client.phone, text)) ?? whatsappShareUrl(text);
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        window.location.assign(url);
      }
    } catch (err) {
      tab?.close();
      toast.error(errorMessage(err));
    } finally {
      setSending(null);
    }
  };

  return (
    <>
      <PageHeader
        title={t('title')}
        description={list.data ? t('subtitle', { days: list.data.reminderDays }) : ' '}
        more={[
          { label: t('back'), icon: ArrowLeft, flipIcon: true, tone: 'ghost', href: '/clients' },
        ]}
      />
      {!canManage ? (
        <Alert role="status">
          <AlertDescription>{t('managersOnly')}</AlertDescription>
        </Alert>
      ) : list.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(list.error)}</AlertDescription>
        </Alert>
      ) : !list.data ? (
        <div className="grid gap-2" aria-busy>
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : list.data.items.length === 0 ? (
        <Card>
          <EmptyState icon={BellRing} title={t('emptyTitle')} description={t('emptyDescription')} />
        </Card>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {list.data.items.map((item) => (
            <li
              key={item.client.id}
              className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-start justify-between gap-3 sm:flex-1">
                <Link href={`/clients/${item.client.id}`} className="min-w-0 hover:underline">
                  <p className="truncate font-medium">{item.client.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    <bdi dir="ltr">{item.client.code}</bdi>
                    {item.client.phone ? (
                      <>
                        {' · '}
                        <bdi dir="ltr">{item.client.phone}</bdi>
                      </>
                    ) : null}
                  </p>
                </Link>
                <div className="shrink-0 space-y-1 text-end">
                  <Amount value={item.balance} className="font-semibold text-destructive" />
                  <Badge variant="outline" className="block font-normal">
                    {t('since', { days: item.oldestDays })}
                  </Badge>
                </div>
              </div>
              <Button
                variant="outline"
                className="sm:w-auto"
                disabled={sending === item.client.id}
                onClick={() => void remind(item)}
                aria-label={t('whatsappFor', { name: item.client.name })}
              >
                {sending === item.client.id ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <MessageCircle aria-hidden />
                )}
                {t('whatsapp')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
