'use client';

import { ArrowLeft, ArrowRightLeft, History, Loader2, ShieldAlert } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Feature, isFieldSeller, isTeamLead, type SellerZoneAssignmentDto } from '@erp/shared';
import { EmptyState } from '@/components/shared/empty-state';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth';
import { useSellers } from '@/lib/sales-force';
import { useCommunes } from '@/lib/use-communes';
import { useErrorMessage } from '@/lib/use-error-message';
import { cn } from '@/lib/utils';
import { leadsOrOffice, useAssignZone, useZoneAssignments, useZones } from '@/lib/zones';
import { PlaceNames } from './place-names';
import { CommuneSetPicker } from './place-set-pickers';
import { ZoneError } from './zone-error';

/** Where a seller or pré-vendeur works (phase 40b): now, a move, and the history. */
export function MemberZonePage({ userId }: { userId: string }) {
  return (
    <FeatureGate feature={Feature.SALES_FORCE}>
      <Member userId={userId} />
    </FeatureGate>
  );
}

function Member({ userId }: { userId: string }) {
  const role = useAuth().state.user?.role;
  const tn = useTranslations('nav');
  if (!leadsOrOffice(role)) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title={tn('forbiddenTitle')}
        description={tn('forbiddenBody')}
      />
    );
  }
  return <MemberZone userId={userId} />;
}

function MemberZone({ userId }: { userId: string }) {
  const t = useTranslations('memberZone');
  const tr = useTranslations('roles');
  const errorMessage = useErrorMessage();
  const sellers = useSellers({ orderTakers: true });
  const member = sellers.data?.find((u) => u.id === userId);
  const history = useZoneAssignments(userId);
  const [moving, setMoving] = useState(false);
  const current = history.data?.pages[0]?.current ?? null;
  const items = history.data?.pages.flatMap((p) => p.items) ?? [];
  const canMove = !!member && isFieldSeller(member.role) && history.isSuccess;

  return (
    <>
      <PageHeader
        title={member?.fullName ?? t('title')}
        description={member ? `${t('title')} · ${tr(member.role)}` : undefined}
        more={[
          { label: t('back'), icon: ArrowLeft, flipIcon: true, tone: 'ghost', href: '/zones' },
        ]}
        actions={
          canMove ? (
            <Button onClick={() => setMoving(true)}>
              <ArrowRightLeft aria-hidden />
              {t('move')}
            </Button>
          ) : undefined
        }
      />

      {history.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(history.error)}</AlertDescription>
        </Alert>
      ) : history.isPending ? (
        <div className="space-y-3" aria-busy>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <>
          <Card className="gap-3 py-4" data-testid="current-zone">
            <CardHeader>
              <CardTitle role="heading" aria-level={2} className="text-base">
                {t('current')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {current ? (
                <Assignment item={current} />
              ) : (
                <p className="text-sm text-muted-foreground">{t('none')}</p>
              )}
            </CardContent>
          </Card>
          <Card className="gap-3 py-4" data-testid="zone-history">
            <CardHeader>
              <CardTitle role="heading" aria-level={2} className="text-base">
                {t('history')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {items.length === 0 ? (
                <EmptyState icon={History} title={t('historyEmpty')} className="py-6" />
              ) : (
                <ol className="divide-y">
                  {items.map((a) => (
                    <li key={a.id} className="py-3 first:pt-0 last:pb-0">
                      <Assignment item={a} badge />
                    </li>
                  ))}
                </ol>
              )}
              {history.hasNextPage ? (
                <div className="flex justify-center pt-3">
                  <Button
                    variant="outline"
                    disabled={history.isFetchingNextPage}
                    onClick={() => void history.fetchNextPage()}
                  >
                    {history.isFetchingNextPage ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : null}
                    {t('loadMore')}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </>
      )}

      {moving ? <MoveDialog userId={userId} onClose={() => setMoving(false)} /> : null}
    </>
  );
}

function Assignment({ item, badge }: { item: SellerZoneAssignmentDto; badge?: boolean }) {
  const t = useTranslations('memberZone');
  const format = useFormatter();
  const date = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p dir="auto" className="font-medium break-words">
          {item.zone ? item.zone.name : t('communesOnly')}
        </p>
        {item.zone?.deleted ? <Badge variant="secondary">{t('zoneDeleted')}</Badge> : null}
        {badge && item.validTo === null ? <Badge variant="outline">{t('now')}</Badge> : null}
      </div>
      <PlaceNames communeCodes={item.communeCodes} />
      <p className="text-sm text-muted-foreground">
        {item.validTo === null
          ? t('since', { from: date(item.validFrom) })
          : t('period', { from: date(item.validFrom), to: date(item.validTo) })}
        {item.assignedBy ? ` · ${t('by', { name: item.assignedBy.fullName })}` : ''}
      </p>
    </div>
  );
}

function MoveDialog({ userId, onClose }: { userId: string; onClose: () => void }) {
  const t = useTranslations('memberZone');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const me = useAuth().state.user;
  const lead = !!me && isTeamLead(me.role);
  const zones = useZones();
  const communes = useCommunes();
  const move = useAssignZone(userId);
  const [mode, setMode] = useState<'zone' | 'communes'>('zone');
  const [zoneId, setZoneId] = useState('');
  const [codes, setCodes] = useState<number[]>([]);

  // A team lead gives only what the zones he is responsible for cover (the API checks).
  const cover = communes.data?.zoneCommuneCodes;
  const own =
    lead && cover && zones.data
      ? new Set(zones.data.filter((z) => z.responsible?.id === me.id).flatMap((z) => cover(z)))
      : null;
  const ready = zones.data !== undefined && (!lead || own !== null);
  const choices = !ready
    ? []
    : (zones.data ?? []).filter((z) => !own || cover!(z).every((c) => own.has(c)));
  const valid = mode === 'zone' ? zoneId !== '' : codes.length > 0;

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent className="md:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('moveTitle')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{t('moveHelp')}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <form
          id="move-form"
          className="grid min-w-0 gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            move.mutate(mode === 'zone' ? { zoneId } : { communeCodes: codes }, {
              onSuccess: () => {
                toast.success(t('moved'));
                onClose();
              },
            });
          }}
        >
          {zones.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(zones.error)}
            </p>
          ) : !ready ? (
            <Skeleton className="h-32 w-full" aria-busy />
          ) : own && own.size === 0 ? (
            <Alert role="status">
              <AlertDescription>{t('noOwnZone')}</AlertDescription>
            </Alert>
          ) : (
            <>
              <fieldset className="grid grid-cols-2 gap-2">
                <legend className="mb-2 text-sm font-medium">{t('moveTo')}</legend>
                {(['zone', 'communes'] as const).map((m) => (
                  <label
                    key={m}
                    className={cn(
                      'flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm',
                      mode === m && 'border-primary bg-primary/5',
                    )}
                  >
                    <input
                      type="radio"
                      name="move-mode"
                      className="size-4 shrink-0 accent-primary"
                      checked={mode === m}
                      onChange={() => {
                        setMode(m);
                        move.reset();
                      }}
                    />
                    {t(`mode_${m}`)}
                  </label>
                ))}
              </fieldset>
              {mode === 'zone' ? (
                <div className="space-y-2">
                  <Label htmlFor="move-zone">{t('mode_zone')}</Label>
                  <NativeSelect
                    id="move-zone"
                    value={zoneId}
                    onChange={(e) => {
                      setZoneId(e.target.value);
                      move.reset();
                    }}
                  >
                    <option value="">{t('chooseZone')}</option>
                    {choices.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              ) : (
                <CommuneSetPicker
                  value={codes}
                  onChange={(next) => {
                    setCodes(next);
                    move.reset();
                  }}
                  allowed={own ?? undefined}
                />
              )}
              {own ? <p className="text-xs text-muted-foreground">{t('ownOnly')}</p> : null}
            </>
          )}
          <ZoneError error={move.error} />
        </form>
        <ResponsiveDialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="move-form" disabled={!valid || move.isPending}>
            {move.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t('confirmMove')}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
