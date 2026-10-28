import type { Metadata, Viewport } from 'next';
import { Cairo, Inter } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { preconnect } from 'react-dom';
import { dirFor, TIMEZONE } from '@/i18n/config';
import { Providers } from './providers';
import './globals.css';

const cairo = Cairo({ variable: '--font-arabic', subsets: ['arabic', 'latin'], display: 'swap' });
const inter = Inter({ variable: '--font-latin', subsets: ['latin'], display: 'swap' });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app');
  return {
    title: { default: t('name'), template: `%s · ${t('name')}` },
    description: t('tagline'),
  };
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const dir = dirFor(locale);
  // Every screen starts with a call to the API (session refresh): open the
  // connection while the page loads. Credentialed, like the calls themselves.
  preconnect(process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001', {
    crossOrigin: 'use-credentials',
  });

  return (
    <html
      lang={locale}
      dir={dir}
      suppressHydrationWarning
      className={`${cairo.variable} ${inter.variable}`}
    >
      <body className="font-sans antialiased">
        <NextIntlClientProvider locale={locale} messages={messages} timeZone={TIMEZONE}>
          <Providers dir={dir}>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
