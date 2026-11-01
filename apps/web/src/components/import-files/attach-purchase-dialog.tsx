'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import type { ImportFileDto, PurchasePage } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { api } from '@/lib/api-client';
import { importFileKeys } from '@/lib/import-files';
import { purchaseKeys } from '@/lib/purchases';
import { useErrorMessage } from '@/lib/use-error-message';

/** Puts an existing draft BR in an open dossier. */
export function AttachPurchaseDialog({
  file,
  open,
  onOpenChange,
}: {
  file: ImportFileDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('importFiles');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [purchaseId, setPurchaseId] = useState('');
  const drafts = useQuery({
    queryKey: [...purchaseKeys.all, 'drafts'],
    queryFn: () => api.request<PurchasePage>('/purchases?status=DRAFT&limit=100'),
    enabled: open,
  });
  const inFile = new Set(file.purchases.map((p) => p.id));
  const choices = (drafts.data?.items ?? []).filter((p) => !inFile.has(p.id));

  const attach = useMutation({
    mutationFn: () =>
      api.request<ImportFileDto>(`/import-files/${file.id}/purchases`, {
        method: 'POST',
        body: { purchaseId },
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(importFileKeys.one(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: importFileKeys.all });
      void queryClient.invalidateQueries({ queryKey: purchaseKeys.all });
      toast.success(t('attached'));
      onOpenChange(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="md:max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (purchaseId) attach.mutate();
          }}
        >
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t('attachTitle')}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>{t('attachBody')}</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="attach-br">{t('draftBr')}</Label>
            <NativeSelect
              id="attach-br"
              value={purchaseId}
              onChange={(e) => setPurchaseId(e.target.value)}
            >
              <option value="">{choices.length ? t('chooseDraft') : t('noDrafts')}</option>
              {choices.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.supplier.name} – {p.documentDate}
                  {p.totalCurrency ? ` – ${p.totalCurrency} ${p.currency}` : ''}
                </option>
              ))}
            </NativeSelect>
          </div>
          <ResponsiveDialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={!purchaseId || attach.isPending}>
              {attach.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t('attach')}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
