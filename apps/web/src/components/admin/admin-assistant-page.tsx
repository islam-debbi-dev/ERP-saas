'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BarChart3 } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { AiConfigTestResult, AiProviderConfigDto } from '@erp/shared';
import { AiProviderForm } from '@/components/assistant/ai-provider-form';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi } from '@/lib/admin';

const KEY = ['admin', 'assistant', 'config'] as const;

/** The platform's AI provider (phase 30). */
export function AdminAssistantPage() {
  const t = useTranslations('admin');
  const s = useTranslations('assistantSettings');
  const queryClient = useQueryClient();
  const config = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) =>
      adminApi.request<{ config: AiProviderConfigDto | null }>('/admin/assistant/config', {
        signal,
      }),
  });

  return (
    <div className="space-y-4">
      <Link
        href="/admin"
        className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t('tenants')}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{s('title')}</h1>
          <p className="text-sm text-muted-foreground">{s('platformSubtitle')}</p>
        </div>
        <Button asChild variant="outline" className="min-h-11">
          <Link href="/admin/assistant/usage">
            <BarChart3 aria-hidden />
            {s('usage')}
          </Link>
        </Button>
      </div>
      {config.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <AiProviderForm
          config={config.data?.config ?? null}
          onTest={(body) =>
            adminApi.request<AiConfigTestResult>('/admin/assistant/config/test', {
              method: 'POST',
              body,
            })
          }
          onSave={async (body) => {
            const saved = await adminApi.request<AiProviderConfigDto>('/admin/assistant/config', {
              method: 'PUT',
              body,
            });
            await queryClient.invalidateQueries({ queryKey: KEY });
            return saved;
          }}
        />
      )}
    </div>
  );
}
