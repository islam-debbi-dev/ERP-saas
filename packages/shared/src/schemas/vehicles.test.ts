import { describe, expect, it } from 'vitest';
import { createRouteSchema, assignLivreurSchema, updateRouteSchema } from './tournees';
import { assignDriverSchema, createVehicleTypeSchema, updateVehicleTypeSchema } from './vehicles';
import {
  createWarehouseSchema,
  updateWarehouseSchema,
  warehouseListQuerySchema,
} from './warehouses';

const uuid = '0b7c1a2e-4f6d-4c1a-9a51-2f0e8d7b6c5a';

describe('vehicle type schemas', () => {
  it("accepts the company's own code and trims it", () => {
    const t = createVehicleTypeSchema.parse({ code: ' SELF/MT ', name: 'Self', activity: 'MIXED' });
    expect(t).toEqual({ code: 'SELF/MT', name: 'Self', codePrefix: null, activity: 'MIXED' });
  });

  it('limits the code to 1–20 characters and the prefix to 10', () => {
    const base = { name: 'Gros', activity: 'CASH_VAN' };
    expect(createVehicleTypeSchema.safeParse({ ...base, code: '' }).success).toBe(false);
    expect(createVehicleTypeSchema.safeParse({ ...base, code: 'x'.repeat(21) }).success).toBe(
      false,
    );
    expect(createVehicleTypeSchema.safeParse({ ...base, code: 'x'.repeat(20) }).success).toBe(true);
    expect(
      createVehicleTypeSchema.safeParse({ ...base, code: 'MXT', codePrefix: 'x'.repeat(11) })
        .success,
    ).toBe(false);
  });

  it('knows only our four activities', () => {
    expect(
      createVehicleTypeSchema.safeParse({ code: 'A', name: 'A', activity: 'TAXI' }).success,
    ).toBe(false);
  });

  it('an update changes only what it names, and refuses unknown fields', () => {
    expect(updateVehicleTypeSchema.parse({ codePrefix: '' })).toEqual({ codePrefix: null });
    expect(updateVehicleTypeSchema.safeParse({ tenantId: uuid }).success).toBe(false);
  });
});

describe('vehicle identity on a warehouse', () => {
  const truck = { name: 'Camion 1', type: 'VEHICLE' };

  it('a truck takes a code, a type, a wilaya, a plate and a capacity', () => {
    const w = createWarehouseSchema.parse({
      ...truck,
      code: ' VAN-28 MXT 01 ',
      vehicleTypeId: uuid,
      wilayaCode: 28,
      plateNumber: '',
      capacityKg: 3500,
    });
    expect(w.code).toBe('VAN-28 MXT 01');
    expect(w.plateNumber).toBeNull();
    expect(w.capacityKg).toBe(3500);
  });

  it('limits the code to 30 characters', () => {
    expect(createWarehouseSchema.safeParse({ ...truck, code: 'x'.repeat(31) }).success).toBe(false);
    expect(createWarehouseSchema.safeParse({ ...truck, code: 'x'.repeat(30) }).success).toBe(true);
  });

  it('keeps the wilaya between 1 and 69', () => {
    for (const wilayaCode of [0, 70, 1.5]) {
      expect(createWarehouseSchema.safeParse({ ...truck, wilayaCode }).success).toBe(false);
    }
    for (const wilayaCode of [1, 69]) {
      expect(createWarehouseSchema.safeParse({ ...truck, wilayaCode }).success).toBe(true);
    }
    expect(warehouseListQuerySchema.safeParse({ wilayaCode: '70' }).success).toBe(false);
    expect(warehouseListQuerySchema.parse({ wilayaCode: '28' }).wilayaCode).toBe(28);
  });

  it('refuses a capacity that is not a positive whole number', () => {
    for (const capacityKg of [0, -5, 1.5]) {
      expect(updateWarehouseSchema.safeParse({ capacityKg }).success).toBe(false);
    }
  });

  it('refuses the truck fields on a dépôt, but lets it have a code', () => {
    const depot = { name: 'Dépôt Batna', type: 'SECONDARY' };
    expect(createWarehouseSchema.safeParse({ ...depot, code: 'CDD BATNA 05' }).success).toBe(true);
    for (const extra of [
      { vehicleTypeId: uuid },
      { wilayaCode: 5 },
      { plateNumber: '12345 120 05' },
      { capacityKg: 1000 },
    ]) {
      const r = createWarehouseSchema.safeParse({ ...depot, ...extra });
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.message).toBe('vehicle_fields_on_depot');
    }
    // null = "nothing", which a dépôt may send.
    expect(createWarehouseSchema.safeParse({ ...depot, wilayaCode: null }).success).toBe(true);
  });
});

describe('driver and route schemas', () => {
  it('a driver change names a user or nobody', () => {
    expect(assignDriverSchema.parse({ userId: null, reason: ' ' })).toEqual({ userId: null });
    expect(assignDriverSchema.parse({ userId: uuid, reason: 'congé' }).reason).toBe('congé');
    expect(assignDriverSchema.safeParse({}).success).toBe(false);
    expect(assignDriverSchema.safeParse({ userId: uuid, reason: 'x'.repeat(121) }).success).toBe(
      false,
    );
  });

  it('a route is planned for a vehicle, a seller, or (refused by the API) neither', () => {
    const base = { name: 'Est', weekdays: [1] };
    expect(createRouteSchema.parse({ ...base, vehicleId: uuid }).vehicleId).toBe(uuid);
    expect(createRouteSchema.parse({ ...base, sellerId: uuid }).sellerId).toBe(uuid);
    expect(createRouteSchema.safeParse(base).success).toBe(true);
    expect(updateRouteSchema.parse({ vehicleId: null })).toEqual({ vehicleId: null });
  });

  it('an order goes to a livreur or to a delivery truck', () => {
    expect(assignLivreurSchema.safeParse({}).success).toBe(false);
    expect(assignLivreurSchema.parse({ livreurId: null })).toEqual({ livreurId: null });
    expect(assignLivreurSchema.parse({ deliveryVehicleId: uuid })).toEqual({
      deliveryVehicleId: uuid,
    });
  });
});
