import { useTranslations } from 'next-intl';
import { BrandMark } from '@/components/shared/brand-mark';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';

/** Card used by login and register: brand, title, description, form. */
export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const t = useTranslations('app');
  return (
    <Card className="w-full shadow-sm">
      <CardHeader className="space-y-3">
        <div className="flex items-center gap-2">
          <BrandMark className="size-10 rounded-xl" />
          <div>
            <p className="text-lg font-bold leading-none tracking-tight">{t('name')}</p>
            <p className="text-xs text-muted-foreground">{title}</p>
          </div>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
