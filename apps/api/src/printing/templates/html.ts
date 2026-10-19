import { formatDA, qty, THOUSANDS_SEPARATOR } from '@erp/shared';

/** HTML that is already escaped; anything else interpolated in `html` is escaped. */
export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

type Part = SafeHtml | string | number | null | undefined | false | readonly Part[];

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

function render(part: Part): string {
  if (part === null || part === undefined || part === false) return '';
  if (part instanceof SafeHtml) return part.value;
  if (Array.isArray(part)) return (part as readonly Part[]).map(render).join('');
  return escapeHtml(String(part));
}

/** Tagged template: `html\`<td>${designation}</td>\`` escapes `designation`. */
export function html(strings: TemplateStringsArray, ...parts: Part[]): SafeHtml {
  let out = strings[0] ?? '';
  parts.forEach((p, i) => {
    out += render(p) + (strings[i + 1] ?? '');
  });
  return new SafeHtml(out);
}

// ---------------------------------------------------------------- formatting

/** `1 234,50` (the column header says DA). */
export const da = (value: string): string => formatDA(value, { currency: false });

/** `1 234,50 DA`. */
export const daWithCurrency = (value: string): string => formatDA(value);

/** `12.500` → `12,5`; `1200.000` → `1 200`. */
export function quantity(value: string): string {
  const [int = '0', dec = ''] = qty(value).toFixed(3).replace(/0+$/, '').split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, THOUSANDS_SEPARATOR);
  return dec ? `${grouped},${dec}` : grouped;
}

/** `19.00` → `19`, `9.50` → `9,5`. */
export const rate = (value: string): string => quantity(value);

/** Calendar date `2026-10-19` → `19/10/2026`. */
export function day(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

const ALGIERS = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Africa/Algiers',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const ALGIERS_TIME = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Africa/Algiers',
  hour: '2-digit',
  minute: '2-digit',
});

/** Timestamp → `19/10/2026` in Africa/Algiers. */
export const dayOf = (iso: string): string => ALGIERS.format(new Date(iso));

/** Timestamp → `19/10/2026 14:05` in Africa/Algiers. */
export const dateTimeOf = (iso: string): string =>
  `${ALGIERS.format(new Date(iso))} ${ALGIERS_TIME.format(new Date(iso))}`;
