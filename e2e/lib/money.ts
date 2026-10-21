import Decimal from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** Exact decimal comparison of money/quantity strings. Never uses JS numbers. */
export function money(value: string | number | Decimal): Decimal {
  return new Decimal(typeof value === 'number' ? value.toFixed(2) : value);
}

export function eq(a: string | number | Decimal, b: string | number | Decimal): boolean {
  return money(a).eq(money(b));
}

export function gte(a: string | number | Decimal, b: string | number | Decimal): boolean {
  return money(a).gte(money(b));
}

export function lte(a: string | number | Decimal, b: string | number | Decimal): boolean {
  return money(a).lte(money(b));
}

export function add(...values: (string | number | Decimal)[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(money(v)), new Decimal(0));
}

export function sub(a: string | number | Decimal, b: string | number | Decimal): Decimal {
  return money(a).minus(money(b));
}

export function mul(a: string | number | Decimal, b: string | number | Decimal): Decimal {
  return money(a).times(money(b));
}

/** Formats like the app does: `1 234 567,89 DA`. */
export function formatDA(value: string | number | Decimal): string {
  const d = money(value);
  const [int, dec] = d.toFixed(2).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${grouped},${dec} DA`;
}
