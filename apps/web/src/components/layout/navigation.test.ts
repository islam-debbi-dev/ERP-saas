import { describe, expect, it } from 'vitest';
import { Feature, Permission, Role, ROLE_PERMISSIONS } from '@erp/shared';
import { routeForbidden } from './navigation';

const ALL = Object.values(Feature);
const closed = (path: string, role: Role, features: readonly Feature[] = ALL) =>
  routeForbidden(path, features, role, ROLE_PERMISSIONS[role]);

describe('routeForbidden', () => {
  it("closes the planners' screens to a livreur, pages under them included", () => {
    for (const path of [
      '/tournees',
      '/tournees/0fcc2d81-d142-4313-9844-914ed6bfd762',
      '/tournees/aujourdhui',
      '/commandes',
      '/commandes/abc',
      '/promotions',
      '/operations-signalees',
      '/primes',
      '/primes/plans/abc',
      '/achats/dossiers',
      '/depenses',
      '/tresorerie',
      '/rh/paie',
    ]) {
      expect(closed(path, Role.LIVREUR), path).toBe(true);
    }
  });

  it('leaves a livreur his own screens and the ones every role has', () => {
    for (const path of [
      '/livraisons',
      '/livraisons/abc',
      '/clients',
      '/clients/abc',
      '/clients/carte',
      '/ventes',
      '/produits',
      '/achats',
      '/stock',
      '/rapports',
      '/parametres',
      '/mon-pointage',
      '/tableau-de-bord',
      '/',
      '/mot-de-passe',
    ]) {
      expect(closed(path, Role.LIVREUR), path).toBe(false);
    }
  });

  it('follows the menu for the other roles', () => {
    expect(closed('/tournees/aujourdhui', Role.SELLER)).toBe(false);
    expect(closed('/tournees', Role.SELLER)).toBe(true);
    expect(closed('/commandes/abc', Role.SELLER)).toBe(false);
    expect(closed('/tournees/abc', Role.SUPERVISOR)).toBe(false);
    expect(closed('/primes', Role.SUPERVISOR)).toBe(true);
    for (const path of ['/tournees', '/commandes', '/primes', '/depenses', '/rh', '/tresorerie']) {
      expect(closed(path, Role.OWNER), path).toBe(false);
    }
  });

  it("lets the planners open a seller's and a livreur's screens, which their menu leaves out", () => {
    for (const role of [Role.OWNER, Role.MANAGER, Role.SUPERVISOR]) {
      for (const path of ['/tournees/aujourdhui', '/livraisons', '/livraisons/abc']) {
        expect(closed(path, role), `${role} ${path}`).toBe(false);
      }
    }
    expect(closed('/livraisons', Role.STOREKEEPER)).toBe(true);
    expect(closed('/tournees/aujourdhui', Role.STOREKEEPER)).toBe(true);
  });

  it('goes by the permission, not the role, where the menu does', () => {
    const perms = (extra: Permission[]) => [...ROLE_PERMISSIONS[Role.LIVREUR], ...extra];
    expect(routeForbidden('/depenses', ALL, Role.LIVREUR, perms([Permission.EXPENSES_VIEW]))).toBe(
      false,
    );
    const noClients = ROLE_PERMISSIONS[Role.SELLER].filter((p) => p !== Permission.CLIENTS_VIEW);
    expect(routeForbidden('/clients/carte', ALL, Role.SELLER, noClients)).toBe(true);
  });

  it('leaves a module the company lacks to its own "not in your edition" page', () => {
    expect(closed('/tournees', Role.LIVREUR, [])).toBe(false);
    expect(closed('/primes', Role.LIVREUR, [Feature.TOURNEES])).toBe(false);
  });
});
