'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { type AiUsageDto, type AiUsageRowDto, algiersDay } from '@erp/shared';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi } from '@/lib/admin';

function UsageTable({ title, rows }: { title: string; rows: AiUsageRowDto[] }) {
  const t = useTranslations('assistantSettings');
  const a = useTranslations('assistant');
  const format = useFormatter();
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-base font-medium">{title}</h2>
      <Card className="p-0">
        <table className="stack-table w-full text-sm">
          <thead>
            <tr className="border-b text-start text-muted-foreground">
              <th className="p-3 text-start font-medium">{t('colCompany')}</th>
              <th className="p-3 text-start font-medium">{t('colModel')}</th>
              <th className="p-3 text-end font-medium">{t('colQuestions')}</th>
              <th className="p-3 text-end font-medium">{t('colTokens')}</th>
              <th className="p-3 text-end font-medium">{t('colCost')}</th>
              <th className="p-3 text-end font-medium">{t('colFeedback')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.tenantId}-${r.provider}-${r.model}`} className="border-b last:border-0">
                <td data-cell="main" className="p-3">
                  {r.tenantName}
                </td>
                <td data-label={t('colModel')} className="p-3">
                  {a(`provider.${r.provider}`)}{' '}
                  <bdi dir="ltr" className="text-muted-foreground">
                    {r.model}
                  </bdi>
                </td>
                <td data-label={t('colQuestions')} className="num p-3 text-end">
                  {format.number(r.questions)}
                </td>
                <td data-label={t('colTokens')} className="num p-3 text-end">
                  {format.number(r.inputTokens + r.outputTokens)}
                  <span className="block text-xs text-muted-foreground">
                    {t('cachedTokens', { count: r.cachedTokens })}
                  </span>
                </td>
                <td data-label={t('colCost')} className="num p-3 text-end">
                  <bdi dir="ltr">${r.costUsd}</bdi>
                </td>
                <td data-label={t('colFeedback')} className="num p-3 text-end">
                  {t('feedbackCount', { up: r.useful, down: r.notUseful })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </section>
  );
}

/** Per company and month; the 👎 answers are how the help articles get better. */
export function AdminAssistantUsagePage() {
  const t = useTranslations('assistantSettings');
  const [month, setMonth] = useState(algiersDay().slice(0, 7));
  const usage = useQuery({
    queryKey: ['admin', 'assistant', 'usage', month],
    enabled: /^\d{4}-\d{2}$/.test(month),
    queryFn: ({ signal }) =>
      adminApi.request<AiUsageDto>(`/admin/assistant/usage?month=${month}`, { signal }),
  });
  const rows = usage.data?.rows ?? [];
  const bad = usage.data?.badAnswers ?? [];

  return (
    <div className="space-y-4">
      <Link
        href="/admin/assistant"
        className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t('title')}
      </Link>
      <h1 className="text-xl font-semibold">{t('usage')}</h1>
      <div className="grid max-w-48 gap-2">
        <Label htmlFor="ai-usage-month">{t('month')}</Label>
        <Input
          id="ai-usage-month"
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
      </div>
      {usage.isPending ? <Skeleton className="h-40 w-full" /> : null}
      {!usage.isPending && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noUsage')}</p>
      ) : null}
      <UsageTable
        title={t('platformKey')}
        rows={rows.filter((r) => r.configScope === 'PLATFORM')}
      />
      <UsageTable title={t('ownKeys')} rows={rows.filter((r) => r.configScope === 'TENANT')} />
      {bad.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-base font-medium">{t('badAnswers')}</h2>
          <ul className="space-y-3">
            {bad.map((b) => (
              <li key={b.id}>
                <Card className="gap-2 p-4 text-sm">
                  <p className="text-xs text-muted-foreground">{b.tenantName}</p>
                  <p dir="auto" className="font-medium">
                    {b.question}
                  </p>
                  <p dir="auto" className="whitespace-pre-wrap">
                    {b.answer}
                  </p>
                  {b.comment ? (
                    <p dir="auto" className="text-muted-foreground">
                      {b.comment}
                    </p>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
