/**
 * Money helpers. Money is never a JS number in business code (AGENTS.md rule 4):
 * use these on top of decimal.js. Values are Decimal(14,2) in the database.
 *
 * Rounding: half-up to 2 decimals, only when a value is stored or displayed,
 * never in the middle of a calculation (docs/architecture.md).
 */
import Decimal from 'decimal.js';

/** Isolated Decimal constructor so other decimal.js users can't change our settings. */
export const MoneyDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Money = InstanceType<typeof MoneyDecimal>;

/** Anything that converts to money exactly. Numbers are accepted only as integer literals. */
export type MoneyInput = Decimal | string | number | bigint;

export function money(value: MoneyInput): Money {
  if (typeof value === 'number' && !Number.isInteger(value)) {
    // A float like 0.1 is already wrong before we see it; force callers to pass strings.
    throw new TypeError(`money(): pass decimals as strings, got float ${value}`);
  }
  if (typeof value === 'bigint') return new MoneyDecimal(value.toString());
  if (value instanceof Decimal) return new MoneyDecimal(value.toString());
  return new MoneyDecimal(value);
}

export const ZERO = money(0);

export function add(a: MoneyInput, b: MoneyInput): Money {
  return money(a).plus(money(b));
}

export function sub(a: MoneyInput, b: MoneyInput): Money {
  return money(a).minus(money(b));
}

/** Multiply (e.g. unit price × quantity, amount × tax rate). Not rounded. */
export function mul(a: MoneyInput, b: MoneyInput): Money {
  return money(a).times(money(b));
}

export function sum(values: readonly MoneyInput[]): Money {
  return values.reduce<Money>((acc, v) => acc.plus(money(v)), ZERO);
}

/** Round half-up to 2 decimals (half away from zero for negatives). */
export function round2(value: MoneyInput): Money {
  return money(value).toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);
}

/** Canonical string for storage / JSON: rounded, always 2 decimals, `.` separator. */
export function toMoneyString(value: MoneyInput): string {
  return round2(value).toFixed(2);
}

/** Thousands separator: narrow no-break space (U+202F), as used in French typography. */
export const THOUSANDS_SEPARATOR = '\u202f';
/** Space between the amount and `DA`: no-break space so it never wraps. */
const CURRENCY_SPACE = '\u00a0';

/**
 * Format for display: `1 234 567,89 DA`.
 * Pass `{ currency: false }` for table cells where the column header says DA.
 */
export function formatDA(value: MoneyInput, options: { currency?: boolean } = {}): string {
  const rounded = round2(value);
  const [intPart = '0', decPart = '00'] = rounded.abs().toFixed(2).split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, THOUSANDS_SEPARATOR);
  const sign = rounded.isNegative() && !rounded.isZero() ? '-' : '';
  const amount = `${sign}${grouped},${decPart}`;
  return options.currency === false ? amount : `${amount}${CURRENCY_SPACE}DA`;
}

/**
 * Parse what a user types: `1 234,5`, `1234.50`, `1 234,50 DA`, `-12,3`.
 * Accepts `,` or `.` as decimal separator and any kind of space as thousands separator.
 * Returns null when the input is not a valid amount (never guesses).
 */
export function parseDA(input: string): Money | null {
  const cleaned = input
    .trim()
    .replace(/\s*DA$/i, '')
    // \s also matches no-break spaces (U+00A0, U+202F).
    .replace(/\s/g, '');
  if (cleaned === '') return null;
  // At most one decimal separator; the other symbol is not allowed as grouping.
  if (!/^-?\d+([.,]\d+)?$/.test(cleaned)) return null;
  return money(cleaned.replace(',', '.'));
}
