'use client';

import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { parseDA, Role } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { useAuth } from '@/lib/auth';
import {
  usePackagingTypes,
  useProductPackaging,
  useSaveProductPackaging,
} from '@/lib/distribution';
import { useErrorMessage } from '@/lib/use-error-message';

interface Row {
  key: string;
  packagingTypeId: string;
  per: string;
}

/**
 * The packaging a saved product travels in (phase 20): 1 casier per 24 bouteilles. A sale
 * then counts the casiers given to the client by itself. Saved on its own (not with the form).
 */
export function ProductPackaging({
  productId,
  baseUnitLabel,
}: {
  productId: string;
  baseUnitLabel: string;
}) {
  const t = useTranslations('packaging');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const { state } = useAuth();
  const writer = state.user?.role === Role.OWNER || state.user?.role === Role.MANAGER;
  const types = usePackagingTypes();
  const current = useProductPackaging(productId);
  const save = useSaveProductPackaging(productId);
  // What the server has, until the user edits it (then the edited copy, until saved).
  const [edited, setEdited] = useState<Row[] | null>(null);
  const saved: Row[] = (current.data ?? []).map((p) => ({
    key: p.packagingTypeId,
    packagingTypeId: p.packagingTypeId,
    per: String(Number(p.qtyBasePerPackaging)),
  }));
  const rows = edited ?? saved;
  const setRows = (fn: (rs: Row[]) => Row[]) => setEdited((cur) => fn(cur ?? saved));

  const list = types.data ?? [];
  if (list.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('noTypesYet')}</p>;
  }
  const valid = rows.every((r) => r.packagingTypeId && parseDA(r.per)?.gt(0));
  const patch = (key: string, p: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">{t('productHelp')}</p>
      {rows.map((r, i) => (
        <div key={r.key} className="grid grid-cols-[1fr_7rem_auto] items-end gap-2">
          <div className="min-w-0 space-y-1">
            <Label htmlFor={`pp-type-${i}`}>{t('type')}</Label>
            <NativeSelect
              id={`pp-type-${i}`}
              disabled={!writer}
              value={r.packagingTypeId}
              onChange={(e) => patch(r.key, { packagingTypeId: e.target.value })}
            >
              <option value="">{t('pickType')}</option>
              {list.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`pp-per-${i}`} className="truncate">
              {t('perPackaging', { unit: baseUnitLabel })}
            </Label>
            <Input
              id={`pp-per-${i}`}
              dir="ltr"
              inputMode="decimal"
              className="num"
              disabled={!writer}
              aria-invalid={!parseDA(r.per)?.gt(0)}
              value={r.per}
              onChange={(e) => patch(r.key, { per: e.target.value })}
            />
          </div>
          {writer ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label={t('removeRow')}
              onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
            >
              <Trash2 aria-hidden />
            </Button>
          ) : null}
        </div>
      ))}
      {writer ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() =>
              setRows((rs) => [...rs, { key: crypto.randomUUID(), packagingTypeId: '', per: '' }])
            }
          >
            <Plus aria-hidden />
            {t('addRow')}
          </Button>
          <Button
            type="button"
            className="min-h-11"
            disabled={!valid || save.isPending}
            onClick={() =>
              save.mutate(
                rows.map((r) => ({
                  packagingTypeId: r.packagingTypeId,
                  qtyBasePerPackaging: parseDA(r.per)?.toString() ?? '0',
                })),
                {
                  onSuccess: () => {
                    setEdited(null);
                    toast.success(t('productSaved'));
                  },
                  onError: (err) => toast.error(errorMessage(err)),
                },
              )
            }
          >
            {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {tc('save')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
