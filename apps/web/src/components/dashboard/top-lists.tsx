'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { DashboardTopDto } from '@erp/shared';
import { useCanOpen } from '@/components/layout/use-visible-nav';
import { Amount } from '@/components/shared/amount';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useUnitLabel } from '@/lib/catalog';
import { formatQty } from '@/lib/stock';

interface Row {
  id: string;
  href: string;
  name: string;
  detail: ReactNode;
  amount: string;
}

/** Five rows; tapping one opens it (when the user may open that page). */
function TopCard({ title, hint, rows }: { title: string; hint?: string; rows: Row[] }) {
  const t = useTranslations('dashboard');
  const canOpen = useCanOpen();
  return (
    <Card className="gap-3 py-4">
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="text-base">
          {title}
        </CardTitle>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('topEmpty')}</p>
        ) : (
          <ol className="divide-y">
            {rows.map((r) => {
              const body = (
                <>
                  <span className="min-w-0 flex-1">
                    <span dir="auto" className="block truncate text-sm font-medium">
                      {r.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{r.detail}</span>
                  </span>
                  <span dir="ltr" className="num shrink-0 text-sm font-medium">
                    <Amount value={r.amount} />
                  </span>
                </>
              );
              return (
                <li key={r.id}>
                  {canOpen(r.href) ? (
                    <Link
                      href={r.href}
                      className="flex min-h-11 items-center gap-3 py-1.5 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-muted"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="flex min-h-11 items-center gap-3 py-1.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

/** Top products, top clients and the clients who stopped buying (phase 33). */
export function TopLists({ top }: { top: DashboardTopDto }) {
  const t = useTranslations('dashboard');
  const format = useFormatter();
  const unitLabel = useUnitLabel();
  const day = (iso: string) =>
    format.dateTime(new Date(`${iso}T12:00:00Z`), { day: 'numeric', month: 'short' });
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-3">
      <TopCard
        title={t('topProducts')}
        rows={top.products.map((p) => ({
          id: p.id,
          href: `/produits/${p.id}`,
          name: p.designation,
          detail: (
            <span dir="ltr" className="num">
              {formatQty(p.qty)} {unitLabel({ code: p.unit, name: null })}
            </span>
          ),
          amount: p.ttc,
        }))}
      />
      <TopCard
        title={t('topClients')}
        rows={top.clients.map((c) => ({
          id: c.id,
          href: `/clients/${c.id}`,
          name: c.name,
          detail: t('documents', { count: c.count }),
          amount: c.ttc,
        }))}
      />
      <TopCard
        title={t('dormantTitle')}
        hint={t('dormantHint')}
        rows={top.dormant.map((c) => ({
          id: c.id,
          href: `/clients/${c.id}`,
          name: c.name,
          detail: t('dormantLast', { day: day(c.lastSale) }),
          amount: c.monthly,
        }))}
      />
    </div>
  );
}
