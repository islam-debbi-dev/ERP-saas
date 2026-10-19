'use client';

import { ChevronDown, Loader2, Printer } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { PrintFormat } from '@erp/shared';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api-client';
import { useTenantSettings } from '@/lib/settings';
import { useErrorMessage } from '@/lib/use-error-message';
import { cn } from '@/lib/utils';

/** The object URL lives long enough for the viewer to load it, then is freed. */
const URL_LIFETIME_MS = 60_000;

/**
 * Opens a document PDF rendered by the API (same output on every machine) in a new
 * tab, where the user prints or saves it. Call it from a click handler.
 * `path` is the API path without the format, e.g. `/documents/FAC/<id>/pdf`;
 * no format = the tenant's default.
 */
export function usePrint() {
  const t = useTranslations('print');
  const errorMessage = useErrorMessage();
  const settings = useTenantSettings();
  const [busy, setBusy] = useState(false);
  const defaultFormat = settings.data?.defaultPrintFormat ?? PrintFormat.A4;

  const print = async (path: string, format: PrintFormat = defaultFormat) => {
    // Open the tab now, inside the click: a tab opened after an await is blocked.
    const tab = window.open('', '_blank');
    if (tab) {
      tab.opener = null;
      tab.document.title = t('preparing');
      tab.document.body.textContent = t('preparing');
    }
    setBusy(true);
    try {
      const separator = path.includes('?') ? '&' : '?';
      const blob = await api.download(`${path}${separator}format=${format}`);
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      window.setTimeout(() => URL.revokeObjectURL(url), URL_LIFETIME_MS);
      if (tab) tab.location.href = url;
      else if (!window.open(url, '_blank')) toast.error(t('popupBlocked'));
    } catch (err) {
      tab?.close();
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return { print, busy, defaultFormat };
}

/**
 * "Imprimer": the main button prints in the tenant's default format, the arrow
 * offers A4 / A5 (see `usePrint`).
 */
export function PrintButton({
  path,
  variant = 'outline',
  size,
  className,
}: {
  path: string;
  variant?: 'outline' | 'ghost' | 'default';
  size?: 'sm' | 'default';
  className?: string;
}) {
  const t = useTranslations('print');
  const { print, busy, defaultFormat } = usePrint();
  const open = (format: PrintFormat) => print(path, format);

  return (
    <div className={cn('inline-flex', className)} role="group" aria-label={t('print')}>
      <Button
        type="button"
        variant={variant}
        size={size}
        className="rounded-e-none"
        disabled={busy}
        onClick={() => void open(defaultFormat)}
      >
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Printer aria-hidden />}
        {t('print')}
        <span className="text-xs text-muted-foreground">{defaultFormat}</span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant={variant}
            size={size}
            className="rounded-s-none border-s-0 px-2"
            disabled={busy}
            aria-label={t('chooseFormat')}
          >
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {[PrintFormat.A4, PrintFormat.A5].map((f) => (
            <DropdownMenuItem key={f} onSelect={() => void open(f)}>
              {t(`format${f}`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
