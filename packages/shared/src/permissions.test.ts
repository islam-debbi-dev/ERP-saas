import { describe, expect, it } from 'vitest';
import { Role } from './enums';
import {
  effectivePermissions,
  Permission,
  PERMISSION_GROUPS,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  SENSITIVE_PERMISSIONS,
} from './permissions';

const sensitive = (ps: readonly string[]) =>
  ps.filter((p) => SENSITIVE_PERMISSIONS.includes(p as Permission));

describe('effectivePermissions', () => {
  it('uses the role defaults', () => {
    // The phase 1–23 sensitive permissions keep their old defaults.
    expect(sensitive(effectivePermissions(Role.MANAGER))).toEqual(
      SENSITIVE_PERMISSIONS.filter((p) => p !== Permission.INCENTIVE_APPROVE),
    );
    expect(sensitive(effectivePermissions(Role.SELLER))).toEqual([]);
    expect(sensitive(effectivePermissions(Role.STOREKEEPER))).toEqual([]);
    expect(sensitive(effectivePermissions(Role.SUPERVISOR))).toEqual([]);
    expect(sensitive(effectivePermissions(Role.LIVREUR))).toEqual([]);
    expect(effectivePermissions(Role.STOREKEEPER, [Permission.STOCK_ADJUST])).toContain(
      Permission.STOCK_ADJUST,
    );
  });

  it('adds grants and removes revokes', () => {
    expect(effectivePermissions(Role.SELLER, [Permission.PRICE_OVERRIDE])).toContain(
      Permission.PRICE_OVERRIDE,
    );
    expect(effectivePermissions(Role.SELLER, [], [Permission.SALES_CREATE])).not.toContain(
      Permission.SALES_CREATE,
    );
    expect(effectivePermissions(Role.MANAGER, [], [Permission.SALE_CANCEL])).not.toContain(
      Permission.SALE_CANCEL,
    );
    // A revoke wins over a grant of the same permission.
    expect(
      effectivePermissions(Role.SELLER, [Permission.EXPORT_DATA], [Permission.EXPORT_DATA]),
    ).not.toContain(Permission.EXPORT_DATA);
  });

  it('never reduces the owner', () => {
    expect(effectivePermissions(Role.OWNER, [], PERMISSIONS)).toEqual(PERMISSIONS);
  });

  it('ignores unknown strings and keeps a stable order', () => {
    const withGrants = effectivePermissions(Role.LIVREUR, [
      'NOPE',
      Permission.EXPORT_DATA,
      Permission.PRICE_OVERRIDE,
    ]);
    expect(withGrants).not.toContain('NOPE');
    expect(sensitive(withGrants)).toEqual([Permission.PRICE_OVERRIDE, Permission.EXPORT_DATA]);
    expect(withGrants).toEqual(PERMISSIONS.filter((p) => withGrants.includes(p)));
  });
});

describe('module permissions (phase 24)', () => {
  it('keeps the dépôt and access permissions to the owner', () => {
    for (const role of [
      Role.MANAGER,
      Role.SUPERVISOR,
      Role.SELLER,
      Role.STOREKEEPER,
      Role.LIVREUR,
    ]) {
      for (const p of [
        Permission.SELL_ANY_PRODUCT,
        Permission.WAREHOUSE_ACCESS_MANAGE,
        Permission.VIEW_ALL_WAREHOUSES,
        Permission.USERS_MANAGE,
      ]) {
        expect(ROLE_PERMISSIONS[role]).not.toContain(p);
      }
    }
  });

  it('lets every role read, the road roles sell, the storekeeper receive', () => {
    for (const role of [Role.SELLER, Role.SUPERVISOR, Role.STOREKEEPER, Role.LIVREUR]) {
      expect(ROLE_PERMISSIONS[role]).toContain(Permission.SALES_VIEW);
    }
    expect(ROLE_PERMISSIONS[Role.SELLER]).toContain(Permission.SALES_CREATE);
    expect(ROLE_PERMISSIONS[Role.STOREKEEPER]).not.toContain(Permission.SALES_CREATE);
    expect(ROLE_PERMISSIONS[Role.STOREKEEPER]).toContain(Permission.PURCHASES_CREATE);
    expect(ROLE_PERMISSIONS[Role.STOREKEEPER]).not.toContain(Permission.PURCHASES_VALIDATE);
    expect(ROLE_PERMISSIONS[Role.LIVREUR]).not.toContain(Permission.PAYMENTS_CREATE);
  });

  it('puts every permission in exactly one group of the grid', () => {
    const grouped = Object.values(PERMISSION_GROUPS).flat();
    expect([...grouped].sort()).toEqual([...PERMISSIONS].sort());
  });
});
