'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { type PriceLevelDto, Role } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { catalogKeys, usePriceLevels } from '@/lib/catalog';
import { useErrorMessage } from '@/lib/use-error-message';

function LevelRow({ level, canEdit }: { level: PriceLevelDto; canEdit: boolean }) {
  const t = useTranslations('priceLevels');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [name, setName] = useState(level.name);
  const id = `price-level-${level.position}`;

  const rename = useMutation({
    mutationFn: () =>
      api.request<PriceLevelDto>(`/price-levels/${level.id}`, {
        method: 'PATCH',
        body: { name: name.trim() },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: catalogKeys.priceLevels });
      toast.success(t('saved'));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() && name.trim() !== level.name) rename.mutate();
      }}
    >
      <div className="flex-1 space-y-2">
        <Label htmlFor={id}>{t('name', { position: level.position })}</Label>
        <Input
          id={id}
          value={name}
          maxLength={40}
          disabled={!canEdit}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      {canEdit ? (
        <Button
          type="submit"
          variant="outline"
          size="icon"
          aria-label={`${tc('save')} — ${t('name', { position: level.position })}`}
          disabled={rename.isPending || !name.trim() || name.trim() === level.name}
        >
          {rename.isPending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Check aria-hidden />
          )}
        </Button>
      ) : null}
    </form>
  );
}

/** Rename the price levels (Gros, Demi-gros, Détail…). The count lives in the sales rules. */
export function PriceLevelsCard() {
  const t = useTranslations('priceLevels');
  const { state } = useAuth();
  const levels = usePriceLevels();
  const canEdit =
    state.status === 'authenticated' &&
    (state.user.role === Role.OWNER || state.user.role === Role.MANAGER);

  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {t('title')}
        </CardTitle>
        <CardDescription>{t('help')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        {levels.isPending ? (
          <Skeleton className="h-16 w-full sm:col-span-2" />
        ) : (
          (levels.data ?? []).map((l) => (
            <LevelRow key={`${l.id}:${l.name}`} level={l} canEdit={canEdit} />
          ))
        )}
      </CardContent>
    </Card>
  );
}
