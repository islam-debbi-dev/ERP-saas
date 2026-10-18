import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Keeps an LTR value (amount, number) in one piece inside a translated sentence.
 * In Arabic, "Plafond : 50 000,00 DA" would otherwise render as "DA 50 000,00".
 */
export function isolateLtr(value: string): string {
  return `⁦${value}⁩`;
}
