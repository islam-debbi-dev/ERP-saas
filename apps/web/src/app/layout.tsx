import type { Metadata, Viewport } from 'next';
import { Fira_Code, Fira_Sans } from 'next/font/google';
import { t } from '@/lib/i18n';
import { Providers } from './providers';
import './globals.css';

const firaSans = Fira_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-fira-sans',
  display: 'swap',
});

const firaCode = Fira_Code({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-fira-code',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: t('app.name'), template: `%s · ${t('app.name')}` },
  description: t('app.tagline'),
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#fafbfc',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${firaSans.variable} ${firaCode.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
