'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, MapPinOff, X } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  Feature,
  type GeoCheckDto,
  GeoReviewStatus,
  type GeoReviewStatus as GeoReviewStatusValue,
  type GeoStatus,
  Role,
} from '@erp/shared';
import { EmptyState } from '@/components/shared/empty-state';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { geoKeys, useGeoCheckPages } from '@/lib/geo';
import { useErrorMessage } from '@/lib/use-error-message';
import { cn } from '@/lib/utils';
import { GeoMap } from './geo-map-lazy';
import { formatDistance } from './geo-format';
import { GeoPrivacyNotice } from './use-geo-submit';

const STATUS_FILTERS: (GeoStatus | undefined)[] = [
  undefined,
  'FAR',
  'MOCKED',
  'LOW_ACCURACY',
  'NO_SIGNAL',
];
const REVIEW_FILTERS: (GeoReviewStatusValue | undefined)[] = [
  GeoReviewStatus.NONE,
  GeoReviewStatus.JUSTIFIED,
  GeoReviewStatus.NOT_JUSTIFIED,
  undefined,
];

/** Opérations signalées (phase 17): what a manager reviews, a supervisor follows. */
export function FlaggedOperations() {
  return (
    <FeatureGate feature={Feature.GEO_CHECK}>
      <Flagged />
    </FeatureGate>
  );
}

function Flagged() {
  const t = useTranslations('geo');
  const errorMessage = useErrorMessage();
  const [status, setStatus] = useState<GeoStatus | undefined>(undefined);
  const [reviewStatus, setReviewStatus] = useState<GeoReviewStatusValue | undefined>(
    GeoReviewStatus.NONE,
  );
  const [open, setOpen] = useState<GeoCheckDto | null>(null);
  const pages = useGeoCheckPages({ status, reviewStatus });
  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />

      <div className="space-y-3">
        <Chips
          label={t('filterStatus')}
          options={STATUS_FILTERS}
          value={status}
          onChange={setStatus}
          render={(s) => (s ? t(`status${s}`) : t('allFlagged'))}
        />
        <Chips
          label={t('filterReview')}
          options={REVIEW_FILTERS}
          value={reviewStatus}
          onChange={setReviewStatus}
          render={(r) => (r ? t(`review${r}`) : t('allReviews'))}
        />
      </div>

      <Card className="p-0">
        {pages.isPending ? (
          <div className="space-y-2 p-4" aria-busy>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : pages.isError ? (
          <p role="alert" className="p-4 text-sm text-destructive">
            {errorMessage(pages.error)}
          </p>
        ) : items.length === 0 ? (
          <EmptyState
            icon={MapPinOff}
            title={t('emptyTitle')}
            description={t('emptyDescription')}
          />
        ) : (
          <ul className="divide-y">
            {items.map((c) => (
              <li key={c.id}>
                <CheckRow check={c} onOpen={() => setOpen(c)} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {pages.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => void pages.fetchNextPage()}
            disabled={pages.isFetchingNextPage}
          >
            {pages.isFetchingNextPage ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t('loadMore')}
          </Button>
        </div>
      ) : null}

      <GeoPrivacyNotice />

      <CheckDialog check={open} onClose={() => setOpen(null)} />
    </>
  );
}

function Chips<T extends string>({
  label,
  options,
  value,
  onChange,
  render,
}: {
  label: string;
  options: (T | undefined)[];
  value: T | undefined;
  onChange: (v: T | undefined) => void;
  render: (v: T | undefined) => string;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o ?? 'all'}
          type="button"
          aria-pressed={value === o}
          onClick={() => onChange(o)}
          className={cn(
            'min-h-11 shrink-0 rounded-full border px-4 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            value === o
              ? 'border-primary bg-primary text-primary-foreground'
              : 'bg-background hover:bg-muted',
          )}
        >
          {render(o)}
        </button>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: GeoStatus }) {
  const t = useTranslations('geo');
  return (
    <Badge variant={status === 'MOCKED' || status === 'FAR' ? 'destructive' : 'secondary'}>
      {t(`status${status}`)}
    </Badge>
  );
}

function ReviewBadge({ review }: { review: GeoReviewStatusValue }) {
  const t = useTranslations('geo');
  return (
    <Badge variant={review === 'NONE' ? 'outline' : 'secondary'}>{t(`review${review}`)}</Badge>
  );
}

function CheckRow({ check, onOpen }: { check: GeoCheckDto; onOpen: () => void }) {
  const t = useTranslations('geo');
  const format = useFormatter();
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-16 w-full items-center justify-between gap-3 px-4 py-3 text-start transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
    >
      <div className="min-w-0">
        <p className="truncate font-medium" title={check.client?.name}>
          {check.client?.name ?? t('noClient')}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {t(`ref${check.refType}`)}
          {check.refNumber ? (
            <>
              {' '}
              <span dir="ltr" className="num">
                {check.refNumber}
              </span>
            </>
          ) : null}
          {check.user ? ` · ${check.user.fullName}` : ''}
          {' · '}
          {format.dateTime(new Date(check.receivedAt), {
            dateStyle: 'short',
            timeStyle: 'short',
            timeZone: 'Africa/Algiers',
          })}
        </p>
        {check.note ? (
          <p className="mt-1 line-clamp-2 text-xs" title={check.note}>
            {check.note}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {check.distanceM !== null ? (
          <span dir="ltr" className="num text-sm font-medium whitespace-nowrap">
            {formatDistance(check.distanceM)}
          </span>
        ) : null}
        <StatusBadge status={check.status} />
        <ReviewBadge review={check.reviewStatus} />
      </div>
    </button>
  );
}

function CheckDialog({ check, onClose }: { check: GeoCheckDto | null; onClose: () => void }) {
  const t = useTranslations('geo');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const role = useAuth().state.user?.role;
  const canReview = role === Role.OWNER || role === Role.MANAGER;
  const [note, setNote] = useState('');

  const review = useMutation({
    mutationFn: (verdict: 'JUSTIFIED' | 'NOT_JUSTIFIED') =>
      api.request<GeoCheckDto>(`/geo-checks/${check?.id}/review`, {
        method: 'POST',
        body: { verdict, ...(note.trim() ? { note: note.trim() } : {}) },
      }),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: geoKeys.all });
      toast.success(t(r.reviewStatus === 'JUSTIFIED' ? 'justifiedToast' : 'notJustifiedToast'));
      setNote('');
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const client =
    check?.client?.lat != null && check.client.lng != null
      ? { lat: check.client.lat, lng: check.client.lng }
      : null;
  const operation =
    check?.lat != null && check.lng != null
      ? { lat: check.lat, lng: check.lng, accuracyM: check.accuracyM }
      : null;

  return (
    <ResponsiveDialog
      open={check !== null}
      onOpenChange={(o) => {
        if (!o) {
          setNote('');
          onClose();
        }
      }}
    >
      <ResponsiveDialogContent className="md:max-w-2xl">
        {check ? (
          <div className="grid gap-4">
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle className="truncate">
                {check.client?.name ?? t('noClient')}
              </ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                {t(`ref${check.refType}`)}
                {check.refNumber ? (
                  <>
                    {' '}
                    <span dir="ltr" className="num">
                      {check.refNumber}
                    </span>
                  </>
                ) : null}
                {check.user ? ` · ${check.user.fullName}` : ''}
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>

            {client || operation ? (
              <GeoMap
                client={client}
                operation={operation}
                labels={{ client: t('mapClient'), operation: t('mapOperation') }}
              />
            ) : (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                {t('noPoints')}
              </p>
            )}

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t('status')}</dt>
              <dd className="flex flex-wrap justify-end gap-1">
                <StatusBadge status={check.status} />
                {check.flags.includes('LATE_SYNC') ? (
                  <Badge variant="outline">{t('flagLATE_SYNC')}</Badge>
                ) : null}
              </dd>
              <dt className="text-muted-foreground">{t('distance')}</dt>
              <dd dir="ltr" className="num text-end">
                {check.distanceM !== null ? formatDistance(check.distanceM) : '—'}
              </dd>
              <dt className="text-muted-foreground">{t('accuracy')}</dt>
              <dd dir="ltr" className="num text-end">
                {check.accuracyM !== null ? `± ${check.accuracyM} m` : '—'}
              </dd>
              <dt className="text-muted-foreground">{t('capturedAt')}</dt>
              <dd className="text-end">
                {format.dateTime(new Date(check.capturedAt ?? check.receivedAt), {
                  dateStyle: 'short',
                  timeStyle: 'short',
                  timeZone: 'Africa/Algiers',
                })}
              </dd>
              <dt className="text-muted-foreground">{t('review')}</dt>
              <dd className="flex justify-end">
                <ReviewBadge review={check.reviewStatus} />
              </dd>
            </dl>

            {check.note ? (
              <div className="rounded-md bg-muted p-3 text-sm">
                <p className="text-xs text-muted-foreground">{t('sellerNote')}</p>
                <p className="break-words">{check.note}</p>
              </div>
            ) : null}
            {check.reviewNote ? (
              <div className="rounded-md bg-muted p-3 text-sm">
                <p className="text-xs text-muted-foreground">
                  {t('reviewNote', { name: check.reviewedBy?.fullName ?? '' })}
                </p>
                <p className="break-words">{check.reviewNote}</p>
              </div>
            ) : null}

            {check.refType === 'SALE' ? (
              <Button asChild variant="link" className="justify-self-start px-0">
                <Link href={`/ventes/${check.refId}`}>{t('openSale')}</Link>
              </Button>
            ) : null}

            {canReview ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="review-note">{t('reviewNoteLabel')}</Label>
                  <Textarea
                    id="review-note"
                    rows={2}
                    maxLength={255}
                    className="text-base"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
                <ResponsiveDialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={review.isPending}
                    onClick={() => review.mutate('NOT_JUSTIFIED')}
                  >
                    <X aria-hidden />
                    {t('notJustified')}
                  </Button>
                  <Button
                    type="button"
                    disabled={review.isPending}
                    onClick={() => review.mutate('JUSTIFIED')}
                  >
                    {review.isPending ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : (
                      <Check aria-hidden />
                    )}
                    {t('justified')}
                  </Button>
                </ResponsiveDialogFooter>
              </>
            ) : null}
          </div>
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
