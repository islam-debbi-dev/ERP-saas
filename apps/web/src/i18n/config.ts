/**
 * UI languages. Arabic is the default (right-to-left). The choice lives in the
 * NEXT_LOCALE cookie, so URLs stay the same in every language.
 */
export const LOCALES = ['ar', 'fr', 'en'] as const;
export type AppLocale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = 'ar';
export const LOCALE_COOKIE = 'NEXT_LOCALE';
export const TIMEZONE = 'Africa/Algiers';

/** Language names are shown in their own script on purpose. */
export const LOCALE_LABELS: Record<AppLocale, string> = {
  ar: 'العربية',
  fr: 'Français',
  en: 'English',
};

export const LOCALE_SHORT: Record<AppLocale, string> = { ar: 'AR', fr: 'FR', en: 'EN' };

export function isLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function dirFor(locale: AppLocale): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}
