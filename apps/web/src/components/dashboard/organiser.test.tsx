import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultDashboardLayout, Role } from '@erp/shared';
import type * as ApiClient from '@/lib/api-client';
import messages from '@/messages/fr.json';
import { Organiser } from './organiser';

const request = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', async (original) => ({
  ...(await original<typeof ApiClient>()),
  api: { request },
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ state: { user: { role: 'OWNER' } } }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const layout = defaultDashboardLayout(Role.OWNER);
const available = ['todo', 'figures', 'chart'] as const;

function renderOrganiser() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="fr" messages={messages}>
        <Organiser layout={layout} available={available} onClose={() => undefined} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  request.mockReset();
});

describe('Organiser', () => {
  it('moves a card with the phone buttons, hides one, and saves his layout', async () => {
    request.mockImplementation((_url: string, opts: { body: unknown }) =>
      Promise.resolve(opts.body),
    );
    renderOrganiser();
    const names = () => screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(names()[0]).toContain('À faire');
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Monter À faire aujourd’hui' })
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Descendre À faire aujourd’hui' }));
    expect(names()[0]).toContain('Chiffres clés');
    fireEvent.click(screen.getByRole('button', { name: 'Masquer Évolution des ventes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(request).toHaveBeenCalled());
    const [url, opts] = request.mock.calls[0] as [
      string,
      { body: { order: string[]; hidden: string[] } },
    ];
    expect(url).toBe('/users/me/dashboard-layout');
    expect(opts.body.order.slice(0, 2)).toEqual(['figures', 'todo']);
    expect(opts.body.hidden).toEqual(['chart']);
  });

  it('“Rétablir par défaut” puts the role order back', () => {
    renderOrganiser();
    fireEvent.click(screen.getByRole('button', { name: 'Descendre À faire aujourd’hui' }));
    fireEvent.click(screen.getByRole('button', { name: /Rétablir par défaut/ }));
    expect(screen.getAllByRole('listitem')[0]!.textContent).toContain('À faire');
  });
});
