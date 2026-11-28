'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import type { ClientBulkAssignInput } from '@erp/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { useBulkAssign, useSectors, useSellers } from '@/lib/sales-force';
import { useErrorMessage } from '@/lib/use-error-message';

/** '' = leave as it is, 'none' = clear it, else the id. */
const KEEP = '';
const NONE = 'none';

const toField = (v: string): string | null | undefined =>
  v === KEEP ? undefined : v === NONE ? null : v;

/** Sets the sector and/or the seller of the selected clients (phase 14, managers). */
export function BulkAssignDialog({
  clientIds,
  open,
  onOpenChange,
  onDone,
}: {
  clientIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const t = useTranslations('assign');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const sectors = useSectors();
  const sellers = useSellers({ orderTakers: true });
  const assign = useBulkAssign();
  const [sector, setSector] = useState(KEEP);
  const [seller, setSeller] = useState(KEEP);
  const [error, setError] = useState<string | null>(null);
  const nothing = sector === KEEP && seller === KEEP;

  const submit = () => {
    setError(null);
    const body: ClientBulkAssignInput = {
      clientIds,
      ...(toField(sector) !== undefined ? { sectorId: toField(sector) } : {}),
      ...(toField(seller) !== undefined ? { assignedSellerId: toField(seller) } : {}),
    };
    assign.mutate(body, {
      onSuccess: (r) => {
        toast.success(t('done', { count: r.updated }));
        onDone();
        onOpenChange(false);
      },
      onError: (err) => setError(errorMessage(err)),
    });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="md:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!nothing) submit();
          }}
        >
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t('title', { count: clientIds.length })}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>{t('help')}</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="assign-sector">{t('sector')}</Label>
            <NativeSelect
              id="assign-sector"
              value={sector}
              onChange={(e) => setSector(e.target.value)}
            >
              <option value={KEEP}>{t('keep')}</option>
              <option value={NONE}>{t('noSector')}</option>
              {(sectors.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor="assign-seller">{t('seller')}</Label>
            <NativeSelect
              id="assign-seller"
              value={seller}
              onChange={(e) => setSeller(e.target.value)}
            >
              <option value={KEEP}>{t('keep')}</option>
              <option value={NONE}>{t('noSeller')}</option>
              {(sellers.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </NativeSelect>
          </div>
          <ResponsiveDialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={nothing || assign.isPending}>
              {assign.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t('submit')}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
