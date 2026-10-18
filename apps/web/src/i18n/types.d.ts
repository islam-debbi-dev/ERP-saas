import type messages from '../messages/fr.json';
import type { AppLocale } from './config';

// Typed keys for useTranslations / getTranslations (a typo is a type error).
declare module 'next-intl' {
  interface AppConfig {
    Locale: AppLocale;
    Messages: typeof messages;
  }
}
