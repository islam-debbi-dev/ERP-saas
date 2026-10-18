import { LanguageSwitcher } from '@/components/shared/language-switcher';
import { ThemeToggle } from '@/components/shared/theme-toggle';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/30 p-6 md:p-10">
      <div className="absolute end-4 top-4 flex items-center gap-1">
        <LanguageSwitcher variant="ghost" showLabel />
        <ThemeToggle />
      </div>
      <div className="flex w-full max-w-md flex-col gap-6">{children}</div>
    </div>
  );
}
