'use client';

import { ArrowLeft, Loader2, MapPinned, Pencil, Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Feature, Role, type SectorDto } from '@erp/shared';
import { SectorLocationPicker } from '@/components/locations/location-picker';
import { EmptyState } from '@/components/shared/empty-state';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth';
import {
  sectorCommuneNames,
  sectorLocationFields,
  sectorOldText,
  type SectorSelection,
  wilayaDisplay,
} from '@/lib/locations';
import { useDeleteSector, useSaveSector, useSectors } from '@/lib/sales-force';
import { useCommunes } from '@/lib/use-communes';
import { useErrorMessage } from '@/lib/use-error-message';

interface Editing {
  /** Null for a new sector. */
  sector: SectorDto | null;
  name: string;
  /** Null until the user changes the location: nothing about it is then rewritten. */
  place: SectorSelection | null;
}

/** Clients > Secteurs (phase 14, SALES_FORCE). */
export function SectorsManager() {
  return (
    <FeatureGate feature={Feature.SALES_FORCE}>
      <Sectors />
    </FeatureGate>
  );
}

function Sectors() {
  const t = useTranslations('sectors');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const { state } = useAuth();
  const writer = state.user?.role === Role.OWNER || state.user?.role === Role.MANAGER;
  const sectors = useSectors();
  const save = useSaveSector();
  const remove = useDeleteSector();
  const [editing, setEditing] = useState<Editing | null>(null);
  const locale = useLocale();
  // Only fetched when a saved sector has codes to name.
  const communes = useCommunes(sectors.data?.some((s) => s.communeCodes.length > 0) ?? false);

  const submit = () => {
    if (!editing || !editing.name.trim()) return;
    save.mutate(
      {
        id: editing.sector?.id ?? null,
        body: {
          name: editing.name.trim(),
          ...sectorLocationFields(editing.sector, editing.place),
        },
      },
      {
        onSuccess: () => {
          toast.success(editing.sector ? t('saved') : t('created'));
          setEditing(null);
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  const list = sectors.data ?? [];
  const stored = editing?.sector ?? null;

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          writer ? (
            <Button onClick={() => setEditing({ sector: null, name: '', place: null })}>
              <Plus aria-hidden />
              {t('new')}
            </Button>
          ) : undefined
        }
        more={[
          { label: t('back'), icon: ArrowLeft, flipIcon: true, tone: 'ghost', href: '/clients' },
        ]}
      />

      <Card className="p-0">
        {sectors.isPending ? (
          <div className="space-y-2 p-4" aria-busy>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : sectors.isError ? (
          <p role="alert" className="p-4 text-sm text-destructive">
            {errorMessage(sectors.error)}
          </p>
        ) : list.length === 0 ? (
          <EmptyState
            icon={MapPinned}
            title={t('emptyTitle')}
            description={t('emptyDescription')}
          />
        ) : (
          <ul className="divide-y">
            {list.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-2 px-4 py-3">
                <div className="min-w-0 space-y-1">
                  <p className="truncate font-medium" title={s.name}>
                    {s.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      wilayaDisplay(s.wilayaCode, s.wilaya, locale),
                      t('clientCount', { count: s.clientCount }),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {s.communes.length > 0 ? (
                    <ul className="flex flex-wrap gap-1" aria-label={t('communes')}>
                      {sectorCommuneNames(communes.data, s, locale).map((c, i) => (
                        <li key={`${c}-${i}`} className="min-w-0 max-w-full">
                          <Badge variant="secondary" className="max-w-full font-normal">
                            <span dir="auto" className="whitespace-normal break-words">
                              {c}
                            </span>
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                {writer ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11"
                      aria-label={t('editNamed', { name: s.name })}
                      onClick={() => setEditing({ sector: s, name: s.name, place: null })}
                    >
                      <Pencil aria-hidden />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-11"
                          aria-label={t('deleteNamed', { name: s.name })}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {t('deleteBody', { count: s.clientCount })}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{tc('cancel')}</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() =>
                              remove.mutate(s.id, {
                                onSuccess: () => toast.success(t('deleted')),
                                onError: (err) => toast.error(errorMessage(err)),
                              })
                            }
                          >
                            {t('delete')}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ResponsiveDialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <ResponsiveDialogContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>
                {editing?.sector ? t('edit') : t('new')}
              </ResponsiveDialogTitle>
              <ResponsiveDialogDescription>{t('help')}</ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            <div className="space-y-2">
              <Label htmlFor="sector-name">{t('name')}</Label>
              <Input
                id="sector-name"
                autoFocus
                required
                maxLength={80}
                value={editing?.name ?? ''}
                onChange={(e) =>
                  setEditing((cur) => (cur ? { ...cur, name: e.target.value } : cur))
                }
              />
            </div>
            {editing ? (
              <SectorLocationPicker
                value={
                  editing.place ?? {
                    wilayaCode: stored?.wilayaCode ?? null,
                    communeCodes: stored?.communeCodes ?? [],
                  }
                }
                touched={editing.place !== null}
                onChange={(place) => setEditing((cur) => (cur ? { ...cur, place } : cur))}
                onUndo={() => setEditing((cur) => (cur ? { ...cur, place: null } : cur))}
                oldText={stored ? sectorOldText(stored) : ''}
                storedNames={
                  new Map(stored?.communeCodes.map((code, i) => [code, stored.communes[i] ?? '']))
                }
              />
            ) : null}
            <ResponsiveDialogFooter>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                {tc('cancel')}
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {tc('save')}
              </Button>
            </ResponsiveDialogFooter>
          </form>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
