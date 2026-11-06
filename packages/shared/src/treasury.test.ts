import { describe, expect, it } from 'vitest';
import { money } from './money';
import {
  cashBalance,
  countEcart,
  countNeedsAlert,
  countsInBalance,
  defaultCashAccount,
  transferLegs,
} from './treasury';

const caisseMain = { id: 'c1', type: 'CAISSE', warehouseId: 'w1', isDefault: true } as const;
const caisseOran = { id: 'c2', type: 'CAISSE', warehouseId: 'w2', isDefault: true } as const;
const caisseSpare = { id: 'c3', type: 'CAISSE', warehouseId: 'w2', isDefault: false } as const;
const bank = { id: 'b1', type: 'BANQUE', warehouseId: null, isDefault: true } as const;
const bankOran = { id: 'b2', type: 'BANQUE', warehouseId: 'w2', isDefault: true } as const;
const all = [caisseMain, caisseOran, caisseSpare, bank, bankOran];

describe('defaultCashAccount', () => {
  const row = { mainWarehouseId: 'w1' };

  it('takes the default caisse of the dépôt for cash', () => {
    expect(defaultCashAccount(all, { ...row, mode: 'ESPECES', warehouseId: 'w2' })).toBe(
      caisseOran,
    );
  });

  it('falls back to the caisse principale', () => {
    expect(defaultCashAccount(all, { ...row, mode: 'ESPECES', warehouseId: 'w9' })).toBe(
      caisseMain,
    );
    expect(defaultCashAccount(all, { ...row, mode: 'ESPECES', warehouseId: null })).toBe(
      caisseMain,
    );
  });

  it('takes the default bank for a cheque or a transfer', () => {
    expect(defaultCashAccount(all, { ...row, mode: 'CHEQUE', warehouseId: 'w1' })).toBe(bank);
    expect(defaultCashAccount(all, { ...row, mode: 'VIREMENT', warehouseId: null })).toBe(bank);
    expect(defaultCashAccount(all, { ...row, mode: 'CHEQUE', warehouseId: 'w2' })).toBe(bankOran);
  });

  it('never picks an account that is not a default', () => {
    expect(defaultCashAccount([caisseSpare], { ...row, mode: 'ESPECES', warehouseId: 'w2' })).toBe(
      null,
    );
  });
});

describe('cashBalance', () => {
  const movements = [
    { amount: '1000.00', date: '2026-10-01' },
    { amount: '-250.50', date: '2026-11-01' },
    { amount: '5000.00', date: '2026-11-01' },
    { amount: '0.10', date: '2026-11-02' },
    { amount: '0.20', date: '2026-11-02' },
  ];

  it('sums the ledger exactly', () => {
    expect(cashBalance(movements, null).toString()).toBe('5749.8');
  });

  it('leaves out what is dated before the opening, not what is dated on it', () => {
    expect(cashBalance(movements, '2026-11-01').toString()).toBe('4749.8');
    expect(countsInBalance('2026-10-31', '2026-11-01')).toBe(false);
    expect(countsInBalance('2026-11-01', '2026-11-01')).toBe(true);
    expect(countsInBalance('2020-01-01', null)).toBe(true);
  });
});

describe('comptage', () => {
  it('is positive when the till holds more than the books', () => {
    expect(countEcart('1050.00', '1000.00').toString()).toBe('50');
    expect(countEcart('950.25', '1000.00').toString()).toBe('-49.75');
    expect(countEcart('1000', '1000.00').isZero()).toBe(true);
  });

  it('alerts from the threshold up, for a shortage or a surplus', () => {
    expect(countNeedsAlert('-5000', '5000')).toBe(true);
    expect(countNeedsAlert('5000.01', '5000')).toBe(true);
    expect(countNeedsAlert('4999.99', '5000')).toBe(false);
    expect(countNeedsAlert('0', '0')).toBe(false);
  });
});

describe('transferLegs', () => {
  it('sums to zero', () => {
    const legs = transferLegs('1234.56');
    expect(legs.out.toString()).toBe('-1234.56');
    expect(legs.in.plus(legs.out).eq(money(0))).toBe(true);
  });
});
