/**
 * Amount in words ("montant en lettres") in French, as printed on factures:
 * "Arrêtée la présente facture à la somme de : <words>".
 *
 * Traditional spelling (the one Algerian invoices use): hyphens below 100,
 * "vingt et un", "soixante et onze", "quatre-vingts" / "quatre-vingt-un",
 * "deux cents" / "deux cent un", "mille" invariable, "un million de dinars".
 * Integer arithmetic on bigint: money never goes through a JS number.
 */
import { type MoneyInput, round2 } from './money';

const UNITS = [
  'zéro',
  'un',
  'deux',
  'trois',
  'quatre',
  'cinq',
  'six',
  'sept',
  'huit',
  'neuf',
  'dix',
  'onze',
  'douze',
  'treize',
  'quatorze',
  'quinze',
  'seize',
  'dix-sept',
  'dix-huit',
  'dix-neuf',
];
const TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];

/** 0..99. `plural` = "quatre-vingts" may take its s (not before "mille"). */
function below100(n: number, plural: boolean): string {
  if (n < 20) return UNITS[n] ?? '';
  const ten = Math.floor(n / 10);
  const unit = n % 10;
  if (ten === 7) return unit === 1 ? 'soixante et onze' : `soixante-${UNITS[10 + unit]}`;
  if (ten === 8)
    return unit === 0 ? `quatre-vingt${plural ? 's' : ''}` : `quatre-vingt-${UNITS[unit]}`;
  if (ten === 9) return `quatre-vingt-${UNITS[10 + unit]}`;
  const base = TENS[ten] ?? '';
  if (unit === 0) return base;
  return unit === 1 ? `${base} et un` : `${base}-${UNITS[unit]}`;
}

/** 0..999 (0 gives ''). `plural` = "cents"/"vingts" may take their s. */
function below1000(n: number, plural: boolean): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds === 1) parts.push('cent');
  else if (hundreds > 1) parts.push(`${UNITS[hundreds]} cent${rest === 0 && plural ? 's' : ''}`);
  if (rest > 0) parts.push(below100(rest, plural));
  return parts.join(' ');
}

const SCALES: { value: bigint; singular: string; plural: string }[] = [
  { value: 1_000_000_000n, singular: 'milliard', plural: 'milliards' },
  { value: 1_000_000n, singular: 'million', plural: 'millions' },
];

/** A non-negative integer in French words: 80 → "quatre-vingts", 1 000 → "mille". */
export function integerToFrenchWords(value: bigint | number): string {
  let n = BigInt(value);
  if (n < 0n) return `moins ${integerToFrenchWords(-n)}`;
  if (n === 0n) return UNITS[0] ?? 'zéro';
  const parts: string[] = [];
  for (const scale of SCALES) {
    const count = n / scale.value;
    if (count > 0n) {
      // "milliard" and "million" are nouns: "deux cents millions", "un million".
      parts.push(`${integerToFrenchWords(count)} ${count === 1n ? scale.singular : scale.plural}`);
      n %= scale.value;
    }
  }
  const thousands = Number(n / 1000n);
  const rest = Number(n % 1000n);
  // "mille" is invariable and never "un mille"; before it "cent"/"vingt" take no s.
  if (thousands === 1) parts.push('mille');
  else if (thousands > 1) parts.push(`${below1000(thousands, false)} mille`);
  if (rest > 0) parts.push(below1000(rest, true));
  return parts.join(' ');
}

/**
 * Money amount in words with the currency:
 * `1250.5` → "mille deux cent cinquante dinars algériens et cinquante centimes".
 * Centimes are omitted when zero. Rounded half-up to the centime first.
 */
export function numberToFrenchWords(amount: MoneyInput): string {
  const rounded = round2(amount);
  const negative = rounded.isNegative() && !rounded.isZero();
  const [intPart = '0', decPart = '00'] = rounded.abs().toFixed(2).split('.');
  const dinars = BigInt(intPart);
  const centimes = BigInt(decPart);

  // "un million de dinars" (noun scale ending the number), "deux dinars", "un dinar".
  const endsOnScale = dinars >= 1_000_000n && dinars % 1_000_000n === 0n;
  const currency = dinars > 1n ? 'dinars algériens' : 'dinar algérien';
  let words = `${integerToFrenchWords(dinars)} ${endsOnScale ? 'de ' : ''}${currency}`;
  if (centimes > 0n) {
    words += ` et ${integerToFrenchWords(centimes)} centime${centimes > 1n ? 's' : ''}`;
  }
  return negative ? `moins ${words}` : words;
}
