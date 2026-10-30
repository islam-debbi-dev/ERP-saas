'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Loader2, MapPin } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  ErrorCode,
  type GeoCheckResultDto,
  type GeoErrorDetails,
  type GeoInput,
} from '@erp/shared';
import { Button } from '@/components/ui/button';
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
import { ApiError, api } from '@/lib/api-client';
import { clientKeys } from '@/lib/clients';
import { capturePosition, useGeoCaptureOn } from '@/lib/geo';
import { useErrorMessage } from '@/lib/use-error-message';
import { isolateLtr } from '@/lib/utils';
import { formatDistance } from './geo-format';

/** Thrown when the seller closes the note dialog: nothing was saved, nothing to report. */
export class GeoCancelled extends Error {
  constructor() {
    super('geo_cancelled');
  }
}

export const isGeoCancelled = (err: unknown) => err instanceof GeoCancelled;

interface Ask {
  details: GeoErrorDetails;
  resolve: (note: string | null) => void;
}

/**
 * Sends a sale, versement or visit with the phone's position (phase 17, GEO_CHECK, field
 * roles only). When the API answers GEO_NOTE_REQUIRED, asks the seller why and sends again
 * with the note; the request had saved nothing. Render `dialog` once in the screen.
 */
export function useGeoSubmit() {
  const on = useGeoCaptureOn();
  const [ask, setAsk] = useState<Ask | null>(null);
  const last = useRef<GeoInput | null>(null);
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const t = useTranslations('geo');

  const askNote = (details: GeoErrorDetails) =>
    new Promise<string | null>((resolve) => setAsk({ details, resolve }));

  async function run<T>(send: (geo: GeoInput | undefined) => Promise<T>): Promise<T> {
    if (!on) return send(undefined);
    const position = await capturePosition();
    last.current = position;
    try {
      return await send(position ?? undefined);
    } catch (err) {
      if (!(err instanceof ApiError) || err.code !== ErrorCode.GEO_NOTE_REQUIRED) throw err;
      const note = await askNote(err.details as GeoErrorDetails);
      if (note === null) throw new GeoCancelled();
      // Without a position the object carries the note alone (NO_SIGNAL).
      return send(position ? { ...position, note } : { isMocked: false, note });
    }
  }

  /** After a NO_CLIENT_GPS check, offers to save where the seller stands as the client's point. */
  function after(check: GeoCheckResultDto | null | undefined, clientId: string | null) {
    const point = last.current;
    if (!check?.offerSaveClientLocation || !clientId || !point?.lat || !point.lng) return;
    toast.info(t('saveClientPointOffer'), {
      duration: 15000,
      action: {
        label: t('saveClientPoint'),
        onClick: () => {
          api
            .request(`/clients/${clientId}/location`, {
              method: 'PATCH',
              body: { lat: point.lat, lng: point.lng, accuracyM: point.accuracyM ?? null },
            })
            .then(() => {
              toast.success(t('clientPointSaved'));
              void queryClient.invalidateQueries({ queryKey: clientKeys.all });
            })
            .catch((e: unknown) => toast.error(errorMessage(e)));
        },
      },
    });
  }

  const dialog: ReactNode = (
    <GeoNoteDialog
      ask={ask}
      onDone={(note) => {
        ask?.resolve(note);
        setAsk(null);
      }}
    />
  );

  return { on, run, after, dialog };
}

function GeoNoteDialog({
  ask,
  onDone,
}: {
  ask: Ask | null;
  onDone: (note: string | null) => void;
}) {
  const t = useTranslations('geo');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const valid = note.trim().length >= 3;
  const status = ask?.details.status;
  const distance = ask?.details.distanceM;

  const close = (value: string | null) => {
    setSending(value !== null);
    onDone(value);
    setNote('');
    setSending(false);
  };

  return (
    <ResponsiveDialog
      open={ask !== null}
      onOpenChange={(o) => {
        if (!o) close(null);
      }}
    >
      <ResponsiveDialogContent className="md:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) close(note.trim());
          }}
        >
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="flex items-center gap-2">
              <MapPin className="size-5 shrink-0 text-amber-600" aria-hidden />
              {t('noteTitle')}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {status === 'FAR' && distance != null
                ? t('noteBodyFar', { distance: isolateLtr(formatDistance(distance)) })
                : status
                  ? t(`noteBody${status}`)
                  : null}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="geo-note">{t('noteLabel')}</Label>
            <Textarea
              id="geo-note"
              autoFocus
              required
              minLength={3}
              maxLength={255}
              rows={3}
              className="text-base"
              placeholder={t('notePlaceholder')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t('noteReview')}</p>
          </div>
          <ResponsiveDialogFooter>
            <Button type="button" variant="ghost" onClick={() => close(null)}>
              {t('noteCancel')}
            </Button>
            <Button type="submit" disabled={!valid || sending}>
              {sending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t('noteSend')}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/** One line under the forms that capture the position (law 18-07). */
export function GeoPrivacyNotice() {
  const t = useTranslations('geo');
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      {t('privacy')}
    </p>
  );
}
