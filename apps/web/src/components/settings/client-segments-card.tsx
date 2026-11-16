'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, Check, Loader2, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { type ClientSegmentDto, Feature, Permission } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { useFeature, usePermission } from '@/lib/auth';
import { statsKeys, useClientSegments } from '@/lib/distribution-stats';
import { useErrorMessage } from '@/lib/use-error-message';

function useSegmentMutation<T>(fn: (v: T) => Promise<unknown>, done: string) {
  const t = useTranslations('segments');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: statsKeys.segments });
      toast.success(t(done as 'saved'));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

function SegmentRow({ segment, canEdit }: { segment: ClientSegmentDto; canEdit: boolean }) {
  const t = useTranslations('segments');
  const [name, setName] = useState(segment.name);
  const id = `segment-${segment.id}`;
  const rename = useSegmentMutation(
    () =>
      api.request(`/client-segments/${segment.id}`, {
        method: 'PATCH',
        body: { name: name.trim() },
      }),
    'saved',
  );
  const archive = useSegmentMutation(
    () => api.request(`/client-segments/${segment.id}/archive`, { method: 'POST' }),
    'archived',
  );
  return (
    <li>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && name.trim() !== segment.name) rename.mutate(undefined);
        }}
      >
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor={id}>
            <bdi dir="ltr">{segment.code}</bdi> · {t('clients', { count: segment.clientCount })}
          </Label>
          <Input
            id={id}
            value={name}
            maxLength={80}
            disabled={!canEdit}
            className="h-11 text-base"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {canEdit ? (
          <>
            <Button
              type="submit"
              variant="outline"
              size="icon"
              className="size-11"
              aria-label={t('saveName', { name: segment.name })}
              disabled={rename.isPending || !name.trim() || name.trim() === segment.name}
            >
              {rename.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Check aria-hidden />
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label={t('archive', { name: segment.name })}
              disabled={archive.isPending}
              onClick={() => archive.mutate(undefined)}
            >
              <Archive aria-hidden />
            </Button>
          </>
        ) : null}
      </form>
    </li>
  );
}

/**
 * Types de client (phase 37): names the owner gives his clients (détaillant, supérette,
 * café…) to read the statistics by them. No behaviour attached.
 */
export function ClientSegmentsCard() {
  const t = useTranslations('segments');
  const on = useFeature(Feature.DISTRIBUTION_STATS);
  const canEdit = usePermission(Permission.SETTINGS_EDIT);
  const segments = useClientSegments(on);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const create = useSegmentMutation(
    (body: { code: string; name: string }) =>
      api.request('/client-segments', { method: 'POST', body }),
    'created',
  );
  if (!on) return null;
  const live = (segments.data ?? []).filter((s) => !s.archived);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !name.trim()) return;
    create.mutate(
      { code: code.trim(), name: name.trim() },
      {
        onSuccess: () => {
          setCode('');
          setName('');
        },
      },
    );
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {t('title')}
        </CardTitle>
        <CardDescription>{t('help')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {segments.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : live.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {live.map((s) => (
              <SegmentRow key={`${s.id}:${s.name}`} segment={s} canEdit={canEdit} />
            ))}
          </ul>
        )}
        {canEdit ? (
          <form onSubmit={submit} className="grid gap-2 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
            <div className="space-y-1">
              <Label htmlFor="segment-code">{t('code')}</Label>
              <Input
                id="segment-code"
                dir="ltr"
                maxLength={20}
                className="h-11 text-base"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="segment-name">{t('name')}</Label>
              <Input
                id="segment-name"
                maxLength={80}
                className="h-11 text-base"
                value={name}
                placeholder={t('namePlaceholder')}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <Button
              type="submit"
              className="min-h-11"
              disabled={create.isPending || !code.trim() || !name.trim()}
            >
              {create.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Plus aria-hidden />
              )}
              {t('add')}
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
