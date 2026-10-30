import { cleanup, render, screen } from '@testing-library/react';
import { Package } from 'lucide-react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Feature, Role } from '@erp/shared';
import messages from '@/messages/fr.json';
import { NAV_ITEMS, visibleNavGroups } from '@/components/layout/navigation';
import { FeatureGate } from './feature-gate';

const auth = vi.hoisted(() => ({ features: [] as string[], status: 'authenticated' }));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    state:
      auth.status === 'authenticated'
        ? { status: 'authenticated', user: { tenantName: 'SARL Test', features: auth.features } }
        : { status: 'loading', user: null },
  }),
  useFeature: (f: string) => auth.features.includes(f),
}));

vi.mock('@/lib/support', () => ({
  whatsappLink: (text: string) => `https://wa.me/213550000000?text=${encodeURIComponent(text)}`,
}));

function renderGate() {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <FeatureGate feature={Feature.IMPORT_COSTS}>
        <p>Dossiers d’importation</p>
      </FeatureGate>
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  auth.features = [];
  auth.status = 'authenticated';
});

describe('FeatureGate', () => {
  it('shows the page when the company has the module', () => {
    auth.features = [Feature.IMPORT_COSTS];
    renderGate();
    expect(screen.getByText('Dossiers d’importation')).toBeTruthy();
    expect(screen.queryByText('Module non inclus')).toBeNull();
  });

  it('shows which editions have it and the support link otherwise', () => {
    renderGate();
    expect(screen.queryByText('Dossiers d’importation')).toBeNull();
    expect(screen.getByText('Module non inclus')).toBeTruthy();
    expect(screen.getByText(/disponible dans l’édition Import ou Entreprise/)).toBeTruthy();
    const link = screen.getByRole('link', { name: /WhatsApp/ });
    expect(decodeURIComponent(link.getAttribute('href') ?? '')).toContain('SARL Test');
    expect(screen.getByRole('link', { name: /tableau de bord/ }).getAttribute('href')).toBe(
      '/tableau-de-bord',
    );
  });

  it('renders nothing until the user is loaded', () => {
    auth.status = 'loading';
    const { container } = renderGate();
    expect(container.textContent).toBe('');
  });
});

describe('visibleNavGroups', () => {
  it('keeps every core item whatever the modules', () => {
    const keys = (fs: Feature[]) => visibleNavGroups(fs).flatMap((g) => g.items.map((i) => i.key));
    const core = NAV_ITEMS.filter((i) => !i.feature).map((i) => i.key);
    expect(keys([])).toEqual(core);
    expect(keys([...Object.values(Feature)])).toEqual(expect.arrayContaining(core));
    expect(keys([])).toContain('sales');
  });

  it('shows the tournée items to the roles that use them (phase 16)', () => {
    const keys = (role: Role) =>
      visibleNavGroups([Feature.TOURNEES], undefined, role).flatMap((g) =>
        g.items.map((i) => i.key),
      );
    expect(keys(Role.SELLER)).toEqual(expect.arrayContaining(['today', 'orders', 'deliveries']));
    expect(keys(Role.SELLER)).not.toContain('tournees');
    expect(keys(Role.MANAGER)).toEqual(expect.arrayContaining(['tournees', 'orders']));
    expect(keys(Role.LIVREUR)).toContain('deliveries');
    expect(keys(Role.LIVREUR)).not.toContain('orders');
  });

  it('hides the items of a module the company does not have, then empty groups', () => {
    const groups = [
      {
        key: 'groupMain' as const,
        items: [
          { key: 'sales' as const, url: '/ventes', icon: Package },
          { key: 'stock' as const, url: '/depots', icon: Package, feature: Feature.WAREHOUSES },
        ],
      },
      {
        key: 'groupStock' as const,
        items: [
          {
            key: 'purchases' as const,
            url: '/import',
            icon: Package,
            feature: Feature.IMPORT_COSTS,
          },
        ],
      },
    ];
    expect(visibleNavGroups([], groups).map((g) => g.items.map((i) => i.url))).toEqual([
      ['/ventes'],
    ]);
    expect(
      visibleNavGroups([Feature.WAREHOUSES, Feature.IMPORT_COSTS], groups).flatMap((g) =>
        g.items.map((i) => i.url),
      ),
    ).toEqual(['/ventes', '/depots', '/import']);
  });
});
