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

/** A phone or a tablet: no PDF viewer in a tab, so the PDF is shared or saved instead. */
const isTouchDevice = () => window.matchMedia('(pointer: coarse)').matches;

function download(url: string, fileName: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
}

/**
 * Opens a document PDF rendered by the API (same output on every machine) in a new
 * tab, where the user prints or saves it. On a phone (docs/ui.md rule 11) the PDF
 * goes to the share sheet (WhatsApp, Bluetooth printer app…) or, when the phone
 * cannot share files, to the downloads. Call it from a click handler.
 * `path` is the API path without the format, e.g. `/documents/FAC/<id>/pdf`;
 * no format = the tenant's default.
 */
export function usePrint() {
  const t = useTranslations('print');
  const errorMessage = useErrorMessage();
  const settings = useTenantSettings();
  const [busy, setBusy] = useState(false);
  const defaultFormat = settings.data?.defaultPrintFormat ?? PrintFormat.A4;

  const print = async (
    path: string,
    format: PrintFormat = defaultFormat,
    fileName = 'document.pdf',
  ) => {
    const phone = isTouchDevice();
    // Open the tab now, inside the click: a tab opened after an await is blocked.
    const tab = phone ? null : window.open('', '_blank');
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
      if (phone) {
        const file = new File([blob], fileName, { type: 'application/pdf' });
        if (navigator.canShare?.({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: fileName });
            return;
          } catch (err) {
            // Closed by the user: nothing to do. Anything else: save it instead.
            if (err instanceof DOMException && err.name === 'AbortError') return;
          }
        }
        download(url, fileName);
        toast.success(t('downloaded'));
        return;
      }
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
  fileName,
  variant = 'outline',
  size,
  className,
}: {
  path: string;
  /** Name of the file shared or saved on a phone, e.g. the document number. */
  fileName?: string;
  variant?: 'outline' | 'ghost' | 'default';
  size?: 'sm' | 'default';
  className?: string;
}) {
  const t = useTranslations('print');
  const { print, busy, defaultFormat } = usePrint();
  const open = (format: PrintFormat) => print(path, format, fileName && `${fileName}.pdf`);

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
