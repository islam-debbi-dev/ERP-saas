import { ErrorCode, money, type Money, round2, toDzd } from '@erp/shared';
import { AppException } from '../common/app-exception';

export interface Converted {
  /** In DZD, rounded to 2 decimals: what stock, totals and the DZD ledger use. */
  dzd: Money;
  /** The typed amount when the currency is foreign, else null. */
  foreign: Money | null;
  /** 1 for DZD. */
  rate: string;
}

/**
 * An amount typed in `currency` (phase 22). For a foreign currency the bank rate is
 * required; for DZD the rate is ignored and the amount is kept as is.
 */
export function convert(
  currency: string,
  amount: string,
  exchangeRate: string | undefined | null,
): Converted {
  if (currency === 'DZD') return { dzd: money(amount), foreign: null, rate: '1' };
  if (!exchangeRate) {
    throw new AppException(ErrorCode.VALIDATION_FAILED, 'Exchange rate required', {
      field: 'exchangeRate',
      currency,
    });
  }
  return { dzd: round2(toDzd(amount, exchangeRate)), foreign: money(amount), rate: exchangeRate };
}
