import { describe, expect, it } from 'vitest';
import { Role } from './enums';
import { effectivePermissions, Permission, PERMISSIONS } from './permissions';

describe('effectivePermissions', () => {
  it('uses the role defaults', () => {
    expect(effectivePermissions(Role.MANAGER)).toEqual(PERMISSIONS);
    expect(effectivePermissions(Role.SELLER)).toEqual([]);
    expect(effectivePermissions(Role.STOREKEEPER)).toEqual([]);
    expect(effectivePermissions(Role.STOREKEEPER, [Permission.STOCK_ADJUST])).toEqual([
      Permission.STOCK_ADJUST,
    ]);
  });

  it('adds grants and removes revokes', () => {
    expect(effectivePermissions(Role.SELLER, [Permission.PRICE_OVERRIDE])).toEqual([
      Permission.PRICE_OVERRIDE,
    ]);
    expect(effectivePermissions(Role.MANAGER, [], [Permission.SALE_CANCEL])).not.toContain(
      Permission.SALE_CANCEL,
    );
    // A revoke wins over a grant of the same permission.
    expect(
      effectivePermissions(Role.SELLER, [Permission.EXPORT_DATA], [Permission.EXPORT_DATA]),
    ).toEqual([]);
  });

  it('never reduces the owner', () => {
    expect(effectivePermissions(Role.OWNER, [], PERMISSIONS)).toEqual(PERMISSIONS);
  });

  it('ignores unknown strings and keeps a stable order', () => {
    expect(
      effectivePermissions(Role.SELLER, [
        'NOPE',
        Permission.EXPORT_DATA,
        Permission.PRICE_OVERRIDE,
      ]),
    ).toEqual([Permission.PRICE_OVERRIDE, Permission.EXPORT_DATA]);
  });
});
