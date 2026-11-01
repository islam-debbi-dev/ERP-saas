'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import type { ImportFileDto } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { api } from '@/lib/api-client';
import { importFileKeys } from '@/lib/import-files';
import { useErrorMessage } from '@/lib/use-error-message';

/** Creates a dossier, or edits the header of an open one (`file`). */
export function ImportFileFormDialog({
  open,
  onOpenChange,
  file,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file?: ImportFileDto;
  onSaved?: (saved: ImportFileDto) => void;
}) {
  const t = useTranslations('importFiles');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [key] = useState(() => crypto.randomUUID());
  const [fields, setFields] = useState({
    reference: file?.reference ?? '',
    containerNo: file?.containerNo ?? '',
    arrivalDate: file?.arrivalDate ?? '',
    note: file?.note ?? '',
  });

  const save = useMutation({
    mutationFn: () => {
      const body = { ...fields, arrivalDate: fields.arrivalDate || null };
      return file
        ? api.request<ImportFileDto>(`/import-files/${file.id}`, {
            method: 'PUT',
            body: { ...body, version: file.version },
          })
        : api.request<ImportFileDto>('/import-files', {
            method: 'POST',
            body,
            idempotencyKey: key,
          });
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(importFileKeys.one(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: importFileKeys.all });
      toast.success(file ? t('saved') : t('created', { number: saved.number }));
      onOpenChange(false);
      onSaved?.(saved);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const field = (k: keyof typeof fields, ltr = false, type?: string) => (
    <div className={k === 'note' ? 'space-y-2 sm:col-span-2' : 'space-y-2'}>
      <Label htmlFor={`di-${k}`}>{t(k)}</Label>
      <Input
        id={`di-${k}`}
        type={type}
        dir={ltr ? 'ltr' : undefined}
        value={fields[k]}
        onChange={(e) => setFields((f) => ({ ...f, [k]: e.target.value }))}
      />
    </div>
  );

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="md:max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{file ? t('editTitle') : t('new')}</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {field('reference', true)}
            {field('containerNo', true)}
            {field('arrivalDate', true, 'date')}
            {field('note')}
          </div>
          <ResponsiveDialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {file ? tc('save') : t('create')}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
