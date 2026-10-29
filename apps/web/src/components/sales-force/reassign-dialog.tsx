'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { useSellers } from '@/lib/sales-force';

/**
 * Changes the seller of a validated sale or the collector of a versement (phase 14):
 * the new person and a reason, both kept in the journal.
 */
export function ReassignDialog({
  kind,
  currentId,
  open,
  onOpenChange,
  pending,
  error,
  onSubmit,
}: {
  kind: 'seller' | 'collector';
  currentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  error: string | null;
  onSubmit: (userId: string | null, reason: string) => void;
}) {
  const t = useTranslations('reassign');
  const tc = useTranslations('common');
  const sellers = useSellers();
  const [userId, setUserId] = useState(currentId ?? '');
  const [reason, setReason] = useState('');
  const valid = reason.trim().length >= 3 && userId !== (currentId ?? '');

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="md:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !pending) onSubmit(userId || null, reason.trim());
          }}
        >
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t(`${kind}Title`)}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>{t('help')}</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="reassign-user">{t(kind)}</Label>
            <NativeSelect
              id="reassign-user"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              <option value="">{t('none')}</option>
              {(sellers.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor="reassign-reason">{t('reason')}</Label>
            <Input
              id="reassign-reason"
              required
              minLength={3}
              maxLength={255}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <ResponsiveDialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={!valid || pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t('submit')}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
