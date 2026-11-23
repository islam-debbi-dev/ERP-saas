/** A number of at least 4 digits or with decimals, or any number followed by a currency. */
const AMOUNT =
  /\d{1,3}(?:\s\d{3})+(?:[,.]\d+)?(?:\s?(?:DA|DZD|دج))?|\d+(?:[,.]\d+)?\s?(?:DA|DZD|دج)|\d+,\d{2}\b/;

/** `2026-11-20`, `20/11/2026`, `20/11/26` or `20/11`: the phone's rule (M4). */
const DATE = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/;

/** Dates first, so `20/11/2026` is one date and not cut around a number. */
const TOKEN = new RegExp(`(?<date>${DATE.source})|(?<amount>${AMOUNT.source})`, 'g');

export interface TextPart {
  text: string;
  /** Amounts and dates are shown isolated left to right; plain text flows as is. */
  kind: 'text' | 'amount' | 'date';
}

/**
 * Cuts a text around its amounts and dates. Inside Arabic, the bidi algorithm reorders
 * the groups of `1 234 567,89 DA` into `DA 567,89 234 1` and `2026-11-20` into
 * `20-11-2026`: each must be isolated left to right (docs/ui.md, rule 6). Models write
 * them in the middle of sentences, so the renderer finds them.
 */
export function splitAmounts(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index;
    if (start > last) parts.push({ text: text.slice(last, start), kind: 'text' });
    parts.push({ text: m[0], kind: m.groups?.['date'] ? 'date' : 'amount' });
    last = start + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), kind: 'text' });
  return parts;
}
