'use client';

import { ChevronRight, MapPinHouse, Pencil, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Feature, isFieldSeller, Role, type ZoneDto } from '@erp/shared';
import { WithoutCommuneCard } from '@/components/clients/without-commune-card';
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
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth';
import { useSellers } from '@/lib/sales-force';
import { useErrorMessage } from '@/lib/use-error-message';
import { useDeleteZone, useZones } from '@/lib/zones';
import { PlaceNames } from './place-names';
import { ZoneDialog } from './zone-dialog';
import { ZoneError } from './zone-error';

/** Zones (phase 40b): the office writes them; a supervisor or chef de zone reads his. */
export function ZonesPage() {
  return (
    <FeatureGate feature={Feature.SALES_FORCE}>
      <Zones />
    </FeatureGate>
  );
}

function Zones() {
  const t = useTranslations('zones');
  const tc = useTranslations('common');
  const tr = useTranslations('roles');
  const errorMessage = useErrorMessage();
  const role = useAuth().state.user?.role;
  const writer = role === Role.OWNER || role === Role.MANAGER;
  const zones = useZones();
  const remove = useDeleteZone();
  // `opened` changes on a reload after a conflict: the form is then filled again.
  const [editing, setEditing] = useState<{ zone: ZoneDto | null; opened: number } | null>(null);
  const [deleting, setDeleting] = useState<ZoneDto | null>(null);
  const list = zones.data ?? [];

  const reload = async () => {
    const fresh = await zones.refetch();
    setEditing((cur) => {
      if (!cur?.zone) return cur;
      const zone = fresh.data?.find((z) => z.id === cur.zone!.id);
      return zone ? { zone, opened: cur.opened + 1 } : null;
    });
  };

  return (
    <>
      <PageHeader
        title={t('title')}
        description={writer ? t('subtitle') : t('subtitleRead')}
        actions={
          writer ? (
            <Button onClick={() => setEditing({ zone: null, opened: 0 })}>
              <Plus aria-hidden />
              {t('new')}
            </Button>
          ) : undefined
        }
      />

      <WithoutCommuneCard />

      <ZoneError error={remove.error} />

      <Card className="p-0">
        {zones.isPending ? (
          <div className="space-y-2 p-4" aria-busy>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : zones.isError ? (
          <p role="alert" className="p-4 text-sm text-destructive">
            {errorMessage(zones.error)}
          </p>
        ) : list.length === 0 ? (
          <EmptyState
            icon={MapPinHouse}
            title={t('emptyTitle')}
            description={writer ? t('emptyDescription') : t('emptyDescriptionRead')}
          />
        ) : (
          <ul className="divide-y">
            {list.map((z) => (
              <li key={z.id} data-testid="zone-row" className="space-y-2 px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <h2 dir="auto" className="font-medium break-words">
                      {z.name}
                    </h2>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                      <Badge variant="outline" className="font-normal">
                        {t(`kind_${z.kind}`)}
                      </Badge>
                      {z.parentZoneName ? (
                        <span>{t('insideArea', { name: z.parentZoneName })}</span>
                      ) : null}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {z.responsible
                        ? `${t('responsible')} : ${z.responsible.fullName} (${tr(z.responsible.role)})`
                        : t('noResponsible')}
                    </p>
                  </div>
                  {writer ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11"
                        aria-label={t('editNamed', { name: z.name })}
                        onClick={() => {
                          remove.reset();
                          setEditing({ zone: z, opened: 0 });
                        }}
                      >
                        <Pencil aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11"
                        aria-label={t('deleteNamed', { name: z.name })}
                        onClick={() => {
                          remove.reset();
                          setDeleting(z);
                        }}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  ) : null}
                </div>
                <PlaceNames wilayaCodes={z.wilayaCodes} communeCodes={z.communeCodes} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <FieldSellers />

      {editing ? (
        <ZoneDialog
          key={`${editing.zone?.id ?? 'new'}:${editing.opened}`}
          zone={editing.zone}
          zones={list}
          onClose={() => setEditing(null)}
          onReload={() => void reload()}
        />
      ) : null}
      {deleting ? (
        <AlertDialog open onOpenChange={(o) => !o && setDeleting(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('deleteTitle', { name: deleting.name })}</AlertDialogTitle>
              <AlertDialogDescription>{t('deleteBody')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tc('cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  remove.mutate(deleting.id, { onSuccess: () => toast.success(t('deleted')) })
                }
              >
                {t('delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </>
  );
}

/** The sellers and pré-vendeurs the user may move: each opens his zone page. */
function FieldSellers() {
  const t = useTranslations('zones');
  const tr = useTranslations('roles');
  // For a team lead the API lists his own team(s) only.
  const sellers = useSellers({ orderTakers: true });
  const list = (sellers.data ?? []).filter((u) => isFieldSeller(u.role));
  if (list.length === 0) return null;
  return (
    <Card className="gap-3 py-4">
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="text-base">
          {t('sellersTitle')}
        </CardTitle>
        <CardDescription>{t('sellersHelp')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {list.map((u) => (
            <li key={u.id}>
              <Link
                href={`/equipe/${u.id}`}
                className="flex min-h-12 items-center justify-between gap-3 py-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-muted"
              >
                <span className="min-w-0">
                  <span dir="auto" className="block truncate font-medium">
                    {u.fullName}
                  </span>
                  <span className="text-sm text-muted-foreground">{tr(u.role)}</span>
                </span>
                <ChevronRight className="rtl-flip size-5 shrink-0" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
