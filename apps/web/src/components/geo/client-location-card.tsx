'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, LocateFixed, X } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  type ClientDto,
  Feature,
  type GeoInput,
  haversineM,
  type LocationRequestDto,
  OFFICE_ROLES,
} from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api-client';
import { useAuth, useFeature } from '@/lib/auth';
import { clientKeys } from '@/lib/clients';
import { capturePosition, geoKeys, useLocationRequests } from '@/lib/geo';
import { useErrorMessage } from '@/lib/use-error-message';
import { isolateLtr } from '@/lib/utils';
import { GeoMap } from './geo-map-lazy';
import { formatDistance } from './geo-format';
import { GeoPrivacyNotice } from './use-geo-submit';

/** They move a saved point directly; a seller asks (the API decides anyway). */
const DIRECT_ROLES = new Set<string>(OFFICE_ROLES);

type Pending = { kind: 'save'; point: GeoInput } | { kind: 'reject'; request: LocationRequestDto };

/** The client's reference GPS point and the changes waiting for a decision (phase 17). */
export function ClientLocationCard({ client }: { client: ClientDto }) {
  const on = useFeature(Feature.GEO_CHECK);
  if (!on) return null;
  return <LocationCard client={client} />;
}

function LocationCard({ client }: { client: ClientDto }) {
  const t = useTranslations('geo');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const role = useAuth().state.user?.role;
  const requests = useLocationRequests(client.id);
  const [pending, setPending] = useState<Pending | null>(null);
  const [text, setText] = useState('');
  const [locating, setLocating] = useState(false);
  const loc = client.location;
  const asks = !!loc && !!role && !DIRECT_ROLES.has(role);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: clientKeys.all });
    void queryClient.invalidateQueries({ queryKey: geoKeys.all });
  };
  const close = () => {
    setPending(null);
    setText('');
  };

  const save = useMutation({
    mutationFn: (point: GeoInput) => {
      const body = { lat: point.lat, lng: point.lng, accuracyM: point.accuracyM ?? null };
      return asks
        ? api.request(`/clients/${client.id}/location-requests`, {
            method: 'POST',
            body: { ...body, ...(text.trim() ? { note: text.trim() } : {}) },
          })
        : api.request(`/clients/${client.id}/location`, { method: 'PATCH', body });
    },
    onSuccess: () => {
      refresh();
      toast.success(t(asks ? 'requestSent' : 'clientPointSaved'));
      close();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      api.request(`/location-requests/${id}/${approve ? 'approve' : 'reject'}`, {
        method: 'POST',
        body: approve ? {} : { reason: text.trim() },
      }),
    onSuccess: (_r, v) => {
      refresh();
      toast.success(t(v.approve ? 'requestApproved' : 'requestRejected'));
      close();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const locate = async () => {
    setLocating(true);
    const point = await capturePosition();
    setLocating(false);
    if (!point?.lat || !point.lng) {
      toast.error(t('positionUnavailable'));
      return;
    }
    setPending({ kind: 'save', point });
  };

  const point = pending?.kind === 'save' ? pending.point : null;
  const open = requests.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="text-base">
          {t('clientPointTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loc ? (
          <>
            <GeoMap client={loc} labels={{ client: client.name, operation: t('mapOperation') }} />
            <p className="text-xs text-muted-foreground">
              {loc.setAt
                ? t('pointSetAt', {
                    date: format.dateTime(new Date(loc.setAt), {
                      dateStyle: 'medium',
                      timeZone: 'Africa/Algiers',
                    }),
                  })
                : null}
              {loc.accuracyM !== null ? (
                <>
                  {' '}
                  <span dir="ltr" className="num">
                    (± {loc.accuracyM} m)
                  </span>
                </>
              ) : null}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t('noClientPoint')}</p>
        )}

        <Button
          type="button"
          variant={loc ? 'outline' : 'default'}
          className="w-full sm:w-auto"
          disabled={locating || client.archivedAt !== null}
          onClick={() => void locate()}
        >
          {locating ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <LocateFixed aria-hidden />
          )}
          {!loc ? t('savePointHere') : asks ? t('requestMoveHere') : t('movePointHere')}
        </Button>

        {open.length > 0 ? (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">{t('pendingRequests')}</h3>
            <ul className="divide-y rounded-md border">
              {open.map((r) => (
                <li key={r.id} className="space-y-2 p-3 text-sm">
                  <p>
                    {t('requestBy', {
                      name: r.requestedBy?.fullName ?? '',
                      date: format.dateTime(new Date(r.requestedAt), {
                        dateStyle: 'short',
                        timeStyle: 'short',
                        timeZone: 'Africa/Algiers',
                      }),
                    })}
                  </p>
                  {r.previous ? (
                    <p className="text-muted-foreground">
                      {t('requestMoves', {
                        distance: isolateLtr(formatDistance(Math.round(haversineM(r.previous, r)))),
                      })}
                    </p>
                  ) : null}
                  {r.note ? <p className="break-words">{r.note}</p> : null}
                  {r.canDecide ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        className="min-h-11"
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ id: r.id, approve: true })}
                      >
                        <Check aria-hidden />
                        {t('approve')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="min-h-11"
                        disabled={decide.isPending}
                        onClick={() => setPending({ kind: 'reject', request: r })}
                      >
                        <X aria-hidden />
                        {t('reject')}
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <GeoPrivacyNotice />
      </CardContent>

      <ResponsiveDialog
        open={pending !== null}
        onOpenChange={(o) => {
          if (!o) close();
        }}
      >
        <ResponsiveDialogContent className="md:max-w-md">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (pending?.kind === 'save') save.mutate(pending.point);
              else if (pending?.kind === 'reject' && text.trim().length >= 3) {
                decide.mutate({ id: pending.request.id, approve: false });
              }
            }}
          >
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>
                {pending?.kind === 'reject'
                  ? t('rejectTitle')
                  : asks
                    ? t('requestMoveHere')
                    : loc
                      ? t('movePointHere')
                      : t('savePointHere')}
              </ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                {point
                  ? t('confirmPoint', { accuracy: isolateLtr(`± ${point.accuracyM ?? 0} m`) })
                  : t('rejectBody')}
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            {pending?.kind === 'reject' || asks ? (
              <div className="space-y-2">
                <Label htmlFor="geo-text">
                  {pending?.kind === 'reject' ? t('rejectReason') : t('requestNote')}
                </Label>
                <Textarea
                  id="geo-text"
                  rows={2}
                  maxLength={255}
                  className="text-base"
                  required={pending?.kind === 'reject'}
                  minLength={pending?.kind === 'reject' ? 3 : undefined}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </div>
            ) : null}
            <ResponsiveDialogFooter>
              <Button type="button" variant="ghost" onClick={close}>
                {t('noteCancel')}
              </Button>
              <Button
                type="submit"
                variant={pending?.kind === 'reject' ? 'destructive' : 'default'}
                disabled={
                  save.isPending ||
                  decide.isPending ||
                  (pending?.kind === 'reject' && text.trim().length < 3)
                }
              >
                {save.isPending || decide.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : null}
                {pending?.kind === 'reject' ? t('reject') : t('confirm')}
              </Button>
            </ResponsiveDialogFooter>
          </form>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </Card>
  );
}
