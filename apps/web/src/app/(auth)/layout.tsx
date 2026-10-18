import { BonStub } from '@/components/auth/bon-stub';
import { t } from '@/lib/i18n';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <main className="flex flex-col px-4 py-8 sm:px-10">
        <p className="font-semibold">{t('app.name')}</p>
        <div className="flex flex-1 items-center">
          <div className="mx-auto w-full max-w-sm py-10">{children}</div>
        </div>
      </main>
      <aside className="hidden items-center justify-center bg-accent px-10 lg:flex">
        <BonStub />
      </aside>
    </div>
  );
}
