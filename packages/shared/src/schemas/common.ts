import { z } from 'zod';
import { CURRENCIES } from '../landed-cost';
import { parseDA } from '../money';

/** A currency code of `CURRENCIES` (phase 22). */
export const currencyCode = z.enum(CURRENCIES);

/** DZD per 1 unit of a currency (the bank domiciliation rate), > 0, at most 6 decimals. */
export const exchangeRateString = z
  .string()
  .refine((v) => {
    const parsed = parseDA(v);
    return parsed !== null && parsed.gt(0) && parsed.decimalPlaces() <= 6 && parsed.lt(1_000_000);
  }, 'invalid_rate')
  .transform((v) => normalizeDecimal(v));

/** A non-negative money amount sent as a string (`"1500.00"`, `"1 500,00"`), max 2 decimals. */
export const amountString = z.string().refine((v) => {
  const parsed = parseDA(v);
  return parsed !== null && !parsed.isNegative() && parsed.decimalPlaces() <= 2;
}, 'invalid_amount');

/** A rate in percent, 0 to 100, at most `decimals` decimals. */
export const percentString = (decimals: number) =>
  z.string().refine((v) => {
    const parsed = parseDA(v);
    return (
      parsed !== null &&
      !parsed.isNegative() &&
      parsed.lte(100) &&
      parsed.decimalPlaces() <= decimals
    );
  }, 'invalid_rate');

/** A quantity as a string, at most 3 decimals; `positive` refuses 0. */
export const quantityString = (opts: { positive: boolean }) =>
  z.string().refine((v) => {
    const parsed = parseDA(v);
    if (parsed === null || parsed.isNegative() || parsed.decimalPlaces() > 3) return false;
    return opts.positive ? parsed.gt(0) : true;
  }, 'invalid_quantity');

/** Normalizes a parsed decimal string (`"1 500,5"` → `"1500.5"`). Call after validation. */
export function normalizeDecimal(value: string): string {
  const parsed = parseDA(value);
  if (!parsed) throw new Error(`normalizeDecimal: invalid value ${value}`);
  return parsed.toString();
}
