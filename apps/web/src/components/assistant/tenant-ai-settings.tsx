'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  saveTenantAiConfig,
  testTenantAiConfig,
  useTenantAiConfig,
} from '@/lib/assistant';
import { AiProviderForm } from './ai-provider-form';

/** Paramètres > Assistant IA: the OWNER's own provider, when his company may have one. */
export function TenantAiSettings() {
  const t = useTranslations('assistantSettings');
  const queryClient = useQueryClient();
  const config = useTenantAiConfig();

  if (config.isPending) return <Skeleton className="h-96 w-full" />;
  if (!config.data?.allowed) {
    return <Card className="p-4 text-sm text-muted-foreground">{t('notAllowed')}</Card>;
  }
  return (
    <AiProviderForm
      config={config.data.config}
      onTest={testTenantAiConfig}
      onSave={async (input) => {
        const saved = await saveTenantAiConfig(input);
        await queryClient.invalidateQueries({ queryKey: ['assistant'] });
        return saved;
      }}
    />
  );
}
