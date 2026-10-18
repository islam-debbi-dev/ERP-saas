import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import type fr from '../messages/fr.json';
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, TIMEZONE } from './config';

export default getRequestConfig(async () => {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(fromCookie) ? fromCookie : DEFAULT_LOCALE;
  const messages = ((await import(`../messages/${locale}.json`)) as { default: typeof fr }).default;

  return {
    locale,
    timeZone: TIMEZONE,
    messages,
    onError(error) {
      // A missing key must be loud in development but never crash a page.
      if (process.env.NODE_ENV === 'development') console.error('[i18n]', error.message);
    },
  };
});
