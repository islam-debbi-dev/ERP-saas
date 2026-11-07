import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@/lib/api-client';
import { ApiError } from '@/lib/api-client';
import messages from '@/messages/fr.json';
import { EmployeesPage } from './employees-page';

const request = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-client', async (original) => ({
  ...(await original<typeof ApiClient>()),
  api: { request },
}));
vi.mock('@/lib/auth', () => ({ usePermission: () => true, useFeature: () => true }));
vi.mock('@/lib/warehouse-scope', () => ({ useWarehouseFilter: () => undefined }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/shared/feature-gate', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/shared/page-header', () => ({ PageHeader: () => null }));
vi.mock('./employee-dialog', () => ({ EmployeeDialog: () => null }));
vi.mock('./hr-tabs', () => ({ HrTabs: () => null }));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="fr" messages={messages}>
        <EmployeesPage />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  request.mockReset();
});

describe('EmployeesPage', () => {
  it('shows the error with a retry, not an empty list, when the request fails', async () => {
    request.mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', 'boom'));
    renderPage();

    const retry = await screen.findAllByRole('button', { name: messages.common.retry });
    expect(screen.queryByText(messages.hr.noEmployees)).toBeNull();

    request.mockResolvedValueOnce({ items: [], nextCursor: null });
    fireEvent.click(retry[0]!);
    expect((await screen.findAllByText(messages.hr.noEmployees)).length).toBeGreaterThan(0);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('keeps the empty state for a list that really is empty', async () => {
    request.mockResolvedValueOnce({ items: [], nextCursor: null });
    renderPage();
    expect((await screen.findAllByText(messages.hr.noEmployees)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: messages.common.retry })).toBeNull();
  });
});
