import { describe, expect, it } from 'vitest';
import { bouncePaymentSchema, createPaymentSchema } from './payments';

const uuid = '0b6c5a8e-6f4a-4a52-9d1c-2f6c1e1d9a10';

describe('payment schemas', () => {
  it('a versement needs a positive amount and defaults to cash with automatic allocation', () => {
    expect(createPaymentSchema.safeParse({ clientId: uuid, amount: '0' }).success).toBe(false);
    expect(createPaymentSchema.safeParse({ clientId: uuid, amount: '-5' }).success).toBe(false);
    const ok = createPaymentSchema.parse({ clientId: uuid, amount: '50 000,5', reference: '' });
    expect(ok).toMatchObject({
      amount: '50000.5',
      mode: 'ESPECES',
      reference: null,
      dueDate: null,
    });
    expect(ok.allocations).toBeUndefined();
  });

  it('allocations are positive and name each document once', () => {
    const base = { clientId: uuid, amount: '100' };
    expect(
      createPaymentSchema.safeParse({ ...base, allocations: [{ saleId: uuid, amount: '0' }] })
        .success,
    ).toBe(false);
    expect(
      createPaymentSchema.safeParse({
        ...base,
        allocations: [
          { saleId: uuid, amount: '10' },
          { saleId: uuid, amount: '20' },
        ],
      }).success,
    ).toBe(false);
  });

  it('a bounce needs a reason; fees default to zero', () => {
    expect(bouncePaymentSchema.safeParse({}).success).toBe(false);
    expect(bouncePaymentSchema.parse({ reason: 'sans provision' }).bankFees).toBe('0');
  });
});
