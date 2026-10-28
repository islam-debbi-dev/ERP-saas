import { LanguageSwitcher } from '@/components/shared/language-switcher';
import { ThemeToggle } from '@/components/shared/theme-toggle';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/30 px-4 pt-20 pb-6 md:p-10">
      <div className="absolute end-2 top-2 md:end-4 md:top-4 flex items-center gap-1">
        <LanguageSwitcher variant="ghost" showLabel />
        <ThemeToggle />
      </div>
      <main className="flex w-full max-w-md flex-col gap-6">{children}</main>
    </div>
  );
}
