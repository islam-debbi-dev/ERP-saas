import { FileSpreadsheet } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** Entry to Paramètres > Import (products, opening stock, client balances). */
export async function ImportLinkCard() {
  const t = await getTranslations('imports');
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1.5">
          <CardTitle role="heading" aria-level={2}>
            {t('title')}
          </CardTitle>
          <CardDescription>{t('cardHelp')}</CardDescription>
        </div>
        <Button asChild variant="outline">
          <Link href="/parametres/import">
            <FileSpreadsheet aria-hidden />
            {t('open')}
          </Link>
        </Button>
      </CardHeader>
    </Card>
  );
}
