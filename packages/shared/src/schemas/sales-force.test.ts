import { describe, expect, it } from 'vitest';
import { updateUserSchema } from './users';
import { clientBulkAssignSchema, createSectorSchema, reassignSellerSchema } from './sales-force';

const uuid = '0b7c1a2e-4f6d-4c1a-9a51-2f0e8d7b6c5a';

describe('createSectorSchema', () => {
  it('dedupes communes case-insensitively and turns an empty wilaya into null', () => {
    const parsed = createSectorSchema.parse({
      name: 'Est',
      wilaya: '',
      communes: ['Bab Ezzouar', 'bab ezzouar', 'El Harrach'],
    });
    expect(parsed.wilaya).toBeNull();
    expect(parsed.communes).toEqual(['Bab Ezzouar', 'El Harrach']);
  });
});

describe('clientBulkAssignSchema', () => {
  it('needs a sector or a seller, and accepts null to clear', () => {
    expect(clientBulkAssignSchema.safeParse({ clientIds: [uuid] }).success).toBe(false);
    expect(clientBulkAssignSchema.safeParse({ clientIds: [uuid], sectorId: null }).success).toBe(
      true,
    );
    expect(
      clientBulkAssignSchema.safeParse({ clientIds: [uuid], assignedSellerId: uuid }).success,
    ).toBe(true);
  });

  it('refuses duplicates, an empty list and unknown keys', () => {
    expect(
      clientBulkAssignSchema.safeParse({ clientIds: [uuid, uuid], sectorId: null }).success,
    ).toBe(false);
    expect(clientBulkAssignSchema.safeParse({ clientIds: [], sectorId: null }).success).toBe(false);
    expect(
      clientBulkAssignSchema.safeParse({ clientIds: [uuid], sectorId: null, tenantId: uuid })
        .success,
    ).toBe(false);
  });
});

describe('reassignSellerSchema', () => {
  it('needs a reason of at least 3 characters', () => {
    expect(reassignSellerSchema.safeParse({ sellerId: uuid, reason: 'x' }).success).toBe(false);
    expect(reassignSellerSchema.safeParse({ sellerId: null, reason: 'erreur' }).success).toBe(true);
  });
});

describe('updateUserSchema managerId', () => {
  const base = { fullName: 'Ali Vendeur', email: 'ali@demo.dz', phone: '', role: 'SELLER' };
  it('keeps the manager when omitted and accepts null to clear', () => {
    expect(updateUserSchema.parse(base).managerId).toBeUndefined();
    expect(updateUserSchema.parse({ ...base, managerId: null }).managerId).toBeNull();
  });
});
