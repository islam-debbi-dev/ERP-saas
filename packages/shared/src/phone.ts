/**
 * Algerian phone numbers to one canonical form, `+213` + 9 digits, so `0550 12 34 56`,
 * `+213 550123456` and `00213550123456` are the same login. Returns null when the
 * input is not an Algerian mobile or landline number.
 */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[\s.\-()]/g, '');
  let national: string;
  if (/^\+213\d{8,9}$/.test(digits)) national = digits.slice(4);
  else if (/^00213\d{8,9}$/.test(digits)) national = digits.slice(5);
  else if (/^0\d{8,9}$/.test(digits)) national = digits.slice(1);
  else return null;
  // Mobiles are 5/6/7 + 8 digits; landlines are 2–4 + 7 digits (8 with the area code).
  if (/^[567]\d{8}$/.test(national)) return `+213${national}`;
  if (/^[234]\d{7}$/.test(national)) return `+213${national}`;
  return null;
}

/** `+213550123456` → `0550 12 34 56` for display. */
export function formatPhone(phone: string): string {
  if (!phone.startsWith('+213')) return phone;
  const national = `0${phone.slice(4)}`;
  return national.length === 10
    ? `${national.slice(0, 4)} ${national.slice(4, 6)} ${national.slice(6, 8)} ${national.slice(8)}`
    : `${national.slice(0, 3)} ${national.slice(3, 5)} ${national.slice(5, 7)} ${national.slice(7)}`;
}

/** An identifier with an `@` is an email; anything else is read as a phone number. */
export function isEmailIdentifier(identifier: string): boolean {
  return identifier.includes('@');
}

/**
 * `https://wa.me/<number>?text=<message>` for an Algerian number (phase 21 reminders).
 * Null when the number is not one: WhatsApp needs the international form without `+`.
 */
export function whatsappUrl(phone: string, text: string): string | null {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return `https://wa.me/${normalized.slice(1)}?text=${encodeURIComponent(text)}`;
}
