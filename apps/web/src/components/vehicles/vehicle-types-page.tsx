'use client';

import { ArrowLeft, Loader2, Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  Feature,
  Permission,
  VEHICLE_ACTIVITIES,
  type VehicleActivity,
  type VehicleTypeDto,
} from '@erp/shared';
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
import { usePermission } from '@/lib/auth';
import { useErrorMessage } from '@/lib/use-error-message';
import { cn } from '@/lib/utils';
import { useArchiveVehicleType, useSaveVehicleType, useVehicleTypes } from '@/lib/vehicles';
import { VehicleCode } from './vehicle-code';

interface Editing {
  id: string | null;
  code: string;
  name: string;
  codePrefix: string;
  activity: VehicleActivity;
}

/** Paramètres › Types de véhicules (phase 36): the company's own kinds of trucks. */
export function VehicleTypesPage() {
  return (
    <FeatureGate feature={Feature.WAREHOUSES}>
      <Types />
    </FeatureGate>
  );
}

function Types() {
  const t = useTranslations('vehicleTypes');
  const tv = useTranslations('vehicles');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const writer = usePermission(Permission.SETTINGS_EDIT);
  const types = useVehicleTypes();
  const save = useSaveVehicleType();
  const archive = useArchiveVehicleType();
  const [editing, setEditing] = useState<Editing | null>(null);
  const list = types.data ?? [];

  const open = (type?: VehicleTypeDto) =>
    setEditing({
      id: type?.id ?? null,
      code: type?.code ?? '',
      name: type?.name ?? '',
      codePrefix: type?.codePrefix ?? '',
      activity: type?.activity ?? 'CASH_VAN',
    });
  const patch = (change: Partial<Editing>) =>
    setEditing((cur) => (cur ? { ...cur, ...change } : cur));

  const submit = () => {
    if (!editing || !editing.code.trim() || !editing.name.trim()) return;
    save.mutate(
      {
        id: editing.id,
        body: {
          code: editing.code.trim(),
          name: editing.name.trim(),
          codePrefix: editing.codePrefix.trim() || null,
          activity: editing.activity,
        },
      },
      {
        onSuccess: () => {
          toast.success(editing.id ? t('saved') : t('created'));
          setEditing(null);
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          writer ? (
            <Button onClick={() => open()}>
              <Plus aria-hidden />
              {t('new')}
            </Button>
          ) : undefined
        }
        more={[
          {
            label: t('back'),
            icon: ArrowLeft,
            flipIcon: true,
            tone: 'ghost',
            href: '/stock/vehicules',
          },
        ]}
      />

      <Card className="p-0">
        {types.isPending ? (
          <div className="space-y-2 p-4" aria-busy>
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : types.isError ? (
          <p role="alert" className="p-4 text-sm text-destructive">
            {errorMessage(types.error)}
          </p>
        ) : list.length === 0 ? (
          <EmptyState icon={Tags} title={t('emptyTitle')} description={t('emptyDescription')} />
        ) : (
          <ul className="divide-y">
            {list.map((type) => (
              <li key={type.id} className="flex items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0 space-y-1">
                  <p className="flex min-w-0 items-baseline gap-2">
                    <VehicleCode code={type.code} className="shrink-0 font-semibold" />
                    <span className="truncate text-sm" title={type.name}>
                      {type.name}
                    </span>
                  </p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <Badge variant="secondary">{tv(`activity${type.activity}`)}</Badge>
                    <span>{t('vehicleCount', { count: type.vehicleCount })}</span>
                    {type.codePrefix ? <VehicleCode code={type.codePrefix} /> : null}
                  </div>
                </div>
                {writer ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11"
                      aria-label={t('editNamed', { name: type.code })}
                      onClick={() => open(type)}
                    >
                      <Pencil aria-hidden />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-11"
                          aria-label={t('archiveNamed', { name: type.code })}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t('archiveTitle')}</AlertDialogTitle>
                          <AlertDialogDescription>{t('archiveBody')}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{tc('cancel')}</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() =>
                              archive.mutate(type.id, {
                                onSuccess: () => toast.success(t('archived')),
                                onError: (err) => toast.error(errorMessage(err)),
                              })
                            }
                          >
                            {t('archive')}
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
        <ResponsiveDialogContent className="md:max-w-lg">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>{editing?.id ? t('edit') : t('new')}</ResponsiveDialogTitle>
              <ResponsiveDialogDescription>{t('subtitle')}</ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="type-code">{t('code')}</Label>
                <Input
                  id="type-code"
                  dir="ltr"
                  autoFocus
                  required
                  maxLength={20}
                  autoCapitalize="characters"
                  value={editing?.code ?? ''}
                  onChange={(e) => patch({ code: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">{t('codeHint')}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="type-prefix">{t('prefix')}</Label>
                <Input
                  id="type-prefix"
                  dir="ltr"
                  maxLength={10}
                  autoCapitalize="characters"
                  value={editing?.codePrefix ?? ''}
                  onChange={(e) => patch({ codePrefix: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">{t('prefixHint')}</p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="type-name">{t('name')}</Label>
              <Input
                id="type-name"
                required
                maxLength={80}
                value={editing?.name ?? ''}
                onChange={(e) => patch({ name: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">{t('nameHint')}</p>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t('activity')}</legend>
              <div className="grid gap-2" role="radiogroup">
                {VEHICLE_ACTIVITIES.map((a) => (
                  <label
                    key={a}
                    className={cn(
                      'flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 text-sm',
                      editing?.activity === a ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
                    )}
                  >
                    <input
                      type="radio"
                      name="type-activity"
                      className="mt-1 size-4 accent-primary"
                      checked={editing?.activity === a}
                      onChange={() => patch({ activity: a })}
                    />
                    <span className="min-w-0">
                      <span className="block font-medium">{tv(`activity${a}`)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {tv(`activityHelp${a}`)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
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
