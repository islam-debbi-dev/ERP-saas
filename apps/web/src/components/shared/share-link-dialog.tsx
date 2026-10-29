'use client';

import { useMutation } from '@tanstack/react-query';
import { Check, Copy, Link2Off, Loader2, MessageCircle } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { type CreateShareLinkInput, type ShareLinkDto, whatsappUrl } from '@erp/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { createShareLink, revokeShareLink, whatsappShareUrl } from '@/lib/credit';
import { useErrorMessage } from '@/lib/use-error-message';

/**
 * "Partager le lien" (phase 21): creates a 7-day link to the relevé or the facture,
 * opened without login, to copy or send by WhatsApp. The link can be revoked here.
 * `message` builds the WhatsApp text around the link. Mount it only while open: each
 * mount creates one link.
 */
export function ShareLinkDialog({
  open,
  onOpenChange,
  input,
  phone,
  message,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  input: CreateShareLinkInput;
  phone?: string | null;
  message: (url: string) => string;
}) {
  const t = useTranslations('share');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const [copied, setCopied] = useState(false);
  const [revoked, setRevoked] = useState(false);

  const create = useMutation({
    mutationFn: () => createShareLink(input),
    onError: (err) => toast.error(errorMessage(err)),
  });
  const revoke = useMutation({
    mutationFn: (link: ShareLinkDto) => revokeShareLink(link.id),
    onSuccess: () => {
      setRevoked(true);
      toast.success(t('revoked'));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  // One link per mount (the ref keeps React's dev double effect from making two).
  const { mutate } = create;
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    mutate();
  }, [mutate]);

  const link = create.data;
  const text = link ? message(link.url) : '';
  const whatsapp = link ? ((phone && whatsappUrl(phone, text)) ?? whatsappShareUrl(text)) : null;

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="md:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('title')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{t('help')}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        {create.isPending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-busy>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t('creating')}
          </p>
        ) : link ? (
          <div className="grid gap-3">
            <div className="space-y-2">
              <Label htmlFor="share-url">{t('link')}</Label>
              <Input
                id="share-url"
                readOnly
                dir="ltr"
                value={link.url}
                onFocus={(e) => e.target.select()}
                aria-describedby="share-expiry"
                disabled={revoked}
              />
              <p id="share-expiry" className="text-xs text-muted-foreground">
                {revoked
                  ? t('revokedHelp')
                  : t('expires', {
                      date: format.dateTime(new Date(link.expiresAt), { dateStyle: 'medium' }),
                    })}
              </p>
            </div>
            {revoked ? null : (
              <div className="grid gap-2 sm:grid-cols-2">
                <Button asChild>
                  <a href={whatsapp ?? '#'} target="_blank" rel="noopener noreferrer">
                    <MessageCircle aria-hidden />
                    {t('whatsapp')}
                  </a>
                </Button>
                <Button type="button" variant="outline" onClick={() => void copy()}>
                  {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                  {t('copy')}
                </Button>
              </div>
            )}
          </div>
        ) : create.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(create.error)}</AlertDescription>
          </Alert>
        ) : null}

        <ResponsiveDialogFooter>
          {link && !revoked ? (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate(link)}
            >
              <Link2Off aria-hidden />
              {t('revoke')}
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('close')}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
