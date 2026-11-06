import { money, type Money, type MoneyInput, sum, ZERO } from './money';
import type { PaymentMode } from './enums';

/** A caisse holds cash; a banque or a CCP account holds what goes through a bank (phase 34). */
export const CashAccountType = {
  CAISSE: 'CAISSE',
  BANQUE: 'BANQUE',
  CCP: 'CCP',
} as const;
export type CashAccountType = (typeof CashAccountType)[keyof typeof CashAccountType];
export const CASH_ACCOUNT_TYPES = Object.values(CashAccountType);

/** Why money moved on an account. The ledger is append-only: a mistake gets a REVERSAL. */
export const CashMovementType = {
  OPENING: 'OPENING',
  VERSEMENT: 'VERSEMENT',
  SUPPLIER_PAYMENT: 'SUPPLIER_PAYMENT',
  EXPENSE: 'EXPENSE',
  IMPORT_COST: 'IMPORT_COST',
  TRANSFER_OUT: 'TRANSFER_OUT',
  TRANSFER_IN: 'TRANSFER_IN',
  COUNT_ADJUST: 'COUNT_ADJUST',
  REVERSAL: 'REVERSAL',
} as const;
export type CashMovementType = (typeof CashMovementType)[keyof typeof CashMovementType];
export const CASH_MOVEMENT_TYPES = Object.values(CashMovementType);

/** What a default account is chosen from. */
export interface CashAccountChoice {
  id: string;
  type: CashAccountType;
  warehouseId: string | null;
  isDefault: boolean;
}

/**
 * The account a money row goes to when none is given. Cash: the default caisse of the row's
 * dépôt, else the caisse principale (the default caisse of the dépôt principal). Cheque or
 * transfer: the default bank of the row's dépôt, else the company's. The API and the pickers
 * both call this, so what a form prefills is what the API would have chosen.
 */
export function defaultCashAccount<A extends CashAccountChoice>(
  accounts: readonly A[],
  row: { mode: PaymentMode; warehouseId: string | null; mainWarehouseId: string | null },
): A | null {
  const type = row.mode === 'ESPECES' ? CashAccountType.CAISSE : CashAccountType.BANQUE;
  const defaults = accounts.filter((a) => a.type === type && a.isDefault);
  const of = (warehouseId: string | null) =>
    defaults.find((a) => a.warehouseId === warehouseId) ?? null;
  return (
    (row.warehouseId ? of(row.warehouseId) : null) ??
    (type === CashAccountType.CAISSE && row.mainWarehouseId ? of(row.mainWarehouseId) : null) ??
    of(null) ??
    defaults[0] ??
    null
  );
}

/** Whether a movement counts: the opening carries the result of everything dated before it. */
export function countsInBalance(date: string, openingDate: string | null): boolean {
  return openingDate === null || date >= openingDate;
}

/** The balance of an account from its ledger, the way the cached balance is kept. */
export function cashBalance(
  movements: readonly { amount: MoneyInput; date: string }[],
  openingDate: string | null,
): Money {
  return sum(movements.filter((m) => countsInBalance(m.date, openingDate)).map((m) => m.amount));
}

/** Écart of a comptage: positive when the till holds more than the books say. */
export function countEcart(counted: MoneyInput, expected: MoneyInput): Money {
  return money(counted).minus(money(expected));
}

/** Whether an écart is big enough to alert the owner, whatever its sign. */
export function countNeedsAlert(ecart: MoneyInput, threshold: MoneyInput): boolean {
  const abs = money(ecart).abs();
  return abs.gt(ZERO) && abs.gte(money(threshold));
}

/** The two movements of a transfer: they always sum to zero. */
export function transferLegs(amount: MoneyInput): { out: Money; in: Money } {
  const value = money(amount);
  return { out: value.negated(), in: value };
}
