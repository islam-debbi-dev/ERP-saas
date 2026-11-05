/** A number of at least 4 digits or with decimals, or any number followed by a currency. */
const AMOUNT =
  /(\d{1,3}(?:\s\d{3})+(?:[,.]\d+)?(?:\s?(?:DA|DZD|دج))?|\d+(?:[,.]\d+)?\s?(?:DA|DZD|دج)|\d+,\d{2}\b)/g;

export interface TextPart {
  text: string;
  amount: boolean;
}

/**
 * Cuts a text around its amounts. Inside Arabic, the bidi algorithm reorders the groups
 * of `1 234 567,89 DA` into `DA 567,89 234 1`: each amount must be isolated left to right
 * (docs/ui.md, rule 6). Models write amounts in the middle of sentences, so the renderer
 * finds them.
 */
export function splitAmounts(text: string): TextPart[] {
  return text
    .split(AMOUNT)
    .map((part, i) => ({ text: part, amount: i % 2 === 1 }))
    .filter((part) => part.text !== '');
}
