import { describe, expect, it } from 'vitest';
import {
  clientAdjustmentSchema,
  createClientSchema,
  openingBalanceSchema,
  statementQuerySchema,
} from './clients';

describe('client schemas', () => {
  it('normalizes the plafond and accepts no limit', () => {
    const c = createClientSchema.parse({
      code: 'C001',
      name: 'Superette El Baraka',
      creditLimit: '50 000',
    });
    expect(c.creditLimit).toBe('50000');
    expect(c.type).toBe('PARTICULIER');
    expect(
      createClientSchema.parse({ code: 'C2', name: 'X', creditLimit: null }).creditLimit,
    ).toBeNull();
    expect(createClientSchema.safeParse({ code: 'C3', name: 'X', creditLimit: '-1' }).success).toBe(
      false,
    );
  });

  it('opening balance may be negative or zero; adjustments are signed, non-zero and need a reason', () => {
    expect(openingBalanceSchema.parse({ amount: '-1 500,50' }).amount).toBe('-1500.5');
    expect(openingBalanceSchema.safeParse({ amount: '0' }).success).toBe(true);
    expect(clientAdjustmentSchema.safeParse({ amount: '0', reason: 'erreur' }).success).toBe(false);
    expect(clientAdjustmentSchema.safeParse({ amount: '-2000' }).success).toBe(false);
    expect(
      clientAdjustmentSchema.parse({ amount: '-2 000', reason: 'Remise accordée' }).amount,
    ).toBe('-2000');
    expect(clientAdjustmentSchema.safeParse({ amount: '10.123', reason: 'abc' }).success).toBe(
      false,
    );
  });

  it('statement range must be in order', () => {
    expect(statementQuerySchema.safeParse({ from: '2026-10-01', to: '2026-10-31' }).success).toBe(
      true,
    );
    expect(statementQuerySchema.safeParse({ from: '2026-11-01', to: '2026-10-31' }).success).toBe(
      false,
    );
  });
});
