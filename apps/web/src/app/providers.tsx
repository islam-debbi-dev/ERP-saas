'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Direction } from 'radix-ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api-client';
import { AuthProvider } from '@/lib/auth';

export function Providers({ dir, children }: { dir: 'rtl' | 'ltr'; children: React.ReactNode }) {
  const t = useTranslations('common');
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            // Retrying a 4xx never helps; retry network/5xx once.
            retry: (count, err) =>
              count < 1 && !(err instanceof ApiError && err.status >= 400 && err.status < 500),
          },
          mutations: { retry: false },
        },
      }),
  );
  return (
    <Direction.Provider dir={dir}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>{children}</AuthProvider>
          <Toaster
            richColors
            position="top-center"
            dir={dir}
            containerAriaLabel={t('notifications')}
          />
        </QueryClientProvider>
      </ThemeProvider>
    </Direction.Provider>
  );
}
