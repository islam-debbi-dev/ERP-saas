'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChartColumn, HandCoins, Loader2, MapPinned, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { type CreateRouteInput, Feature, type RouteDto } from '@erp/shared';
import { EmptyState } from '@/components/shared/empty-state';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { useSellers } from '@/lib/sales-force';
import { tourneeKeys, useRoutes } from '@/lib/tournees';
import { useErrorMessage } from '@/lib/use-error-message';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';
import { WeekdayPicker, useWeekdayLabels } from './weekdays';

/** Tournées (phase 16): the routes of the sellers, by weekday. */
export function RoutesList() {
  return (
    <FeatureGate feature={Feature.TOURNEES}>
      <Routes />
    </FeatureGate>
  );
}

function Routes() {
  const t = useTranslations('tournees');
  const errorMessage = useErrorMessage();
  const routes = useRoutes();
  const dayLabel = useWeekdayLabels('short');
  const [creating, setCreating] = useState(false);
  const list = routes.data ?? [];

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            {t('newRoute')}
          </Button>
        }
        more={[
          { label: t('closingTitle'), icon: HandCoins, href: '/tournees/cloture' },
          { label: t('reportTitle'), icon: ChartColumn, href: '/tournees/rapports' },
        ]}
      />

      <Card className="p-0">
        {routes.isPending ? (
          <div className="space-y-2 p-4" aria-busy>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : routes.isError ? (
          <p role="alert" className="p-4 text-sm text-destructive">
            {errorMessage(routes.error)}
          </p>
        ) : list.length === 0 ? (
          <EmptyState
            icon={MapPinned}
            title={t('emptyTitle')}
            description={t('emptyDescription')}
          />
        ) : (
          <ul className="divide-y">
            {list.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/tournees/${r.id}`}
                  className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.seller.fullName} · {r.weekdays.map((d) => dayLabel(d)).join(', ')}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {!r.active ? <Badge variant="outline">{t('inactive')}</Badge> : null}
                    <Badge variant="secondary">{t('stopCount', { count: r.stopCount })}</Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <NewRouteDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

function NewRouteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('tournees');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const queryClient = useQueryClient();
  const sellers = useSellers();
  const key = useIdempotencyKey(open);
  const [name, setName] = useState('');
  const [sellerId, setSellerId] = useState('');
  const [weekdays, setWeekdays] = useState<number[]>([]);

  const create = useMutation({
    mutationFn: (body: CreateRouteInput) =>
      api.request<RouteDto>('/routes', { method: 'POST', body, idempotencyKey: key }),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: tourneeKeys.routes });
      onOpenChange(false);
      router.push(`/tournees/${r.id}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const valid = name.trim().length > 0 && sellerId !== '' && weekdays.length > 0;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) create.mutate({ name: name.trim(), sellerId, weekdays, active: true });
          }}
        >
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t('newRoute')}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>{t('newRouteHelp')}</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="route-name">{t('routeName')}</Label>
            <Input
              id="route-name"
              value={name}
              maxLength={80}
              placeholder={t('routeNamePlaceholder')}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="route-seller">{t('seller')}</Label>
            <NativeSelect
              id="route-seller"
              value={sellerId}
              onChange={(e) => setSellerId(e.target.value)}
            >
              <option value="">{t('pickSeller')}</option>
              {(sellers.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                </option>
              ))}
            </NativeSelect>
          </div>
          <WeekdayPicker value={weekdays} onChange={setWeekdays} />
          <ResponsiveDialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={!valid || create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t('createRoute')}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
