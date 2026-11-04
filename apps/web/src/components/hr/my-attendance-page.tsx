'use client';

import { Fingerprint, Loader2, LogIn, LogOut, Plus } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { ErrorCode, Feature, type GeoInput } from '@erp/shared';
import { EmptyState } from '@/components/shared/empty-state';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
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
import { ApiError } from '@/lib/api-client';
import { capturePosition } from '@/lib/geo';
import { useMyAttendance, useSelfAttendance } from '@/lib/hr';
import { useErrorMessage } from '@/lib/use-error-message';
import { DayStatusBadge, DayStatusCell } from './day-status';
import { LeaveDialog } from './leave-dialog';
import { LeaveRow } from './leaves-page';
import { CountsList } from './month-page';

type Kind = 'check-in' | 'check-out';

export function MyAttendancePage() {
  return (
    <FeatureGate feature={Feature.HR}>
      <Mine />
    </FeatureGate>
  );
}

/** "Mon pointage": one position per tap, never tracked in between (law 18-07). */
function Mine() {
  const t = useTranslations('hr');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const me = useMyAttendance();
  const self = useSelfAttendance();
  const [locating, setLocating] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [needsNote, setNeedsNote] = useState<{ kind: Kind; geo: GeoInput | undefined } | null>(
    null,
  );
  const [note, setNote] = useState('');

  const send = (kind: Kind, geo: GeoInput | undefined) =>
    self.mutate(
      { kind, geo },
      {
        onSuccess: () => {
          setNeedsNote(null);
          setNote('');
          toast.success(t(kind === 'check-in' ? 'checkedIn' : 'checkedOut'));
        },
        onError: (err) => {
          if (err instanceof ApiError && err.code === ErrorCode.GEO_NOTE_REQUIRED) {
            setNeedsNote({ kind, geo });
          } else {
            toast.error(errorMessage(err));
          }
        },
      },
    );

  const tap = async (kind: Kind) => {
    setLocating(true);
    const geo = await capturePosition();
    setLocating(false);
    send(kind, geo ?? undefined);
  };

  if (me.isPending) return <Skeleton className="h-64 w-full" />;
  if (me.isError) {
    return <EmptyState icon={Fingerprint} title={errorMessage(me.error)} />;
  }
  const d = me.data;
  const busy = locating || self.isPending;
  const time = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { timeStyle: 'short', timeZone: 'Africa/Algiers' }) : null;
  const checkedIn = d.today.checkedInAt !== null;
  const checkedOut = d.today.checkedOutAt !== null;

  return (
    <>
      <PageHeader title={t('myTitle')} description={d.employee.fullName} />
      <Card className="gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">{t('myToday')}</h2>
          <DayStatusBadge status={d.today.status} />
        </div>
        {checkedIn ? (
          <p className="text-sm text-muted-foreground">
            {t('checkedInAt', { time: time(d.today.checkedInAt) ?? '' })}
            {checkedOut ? `, ${t('checkedOutAt', { time: time(d.today.checkedOutAt) ?? '' })}` : ''}
          </p>
        ) : null}
        {d.selfCheckIn ? (
          <>
            {!checkedOut ? (
              <Button
                size="lg"
                className="min-h-14 w-full text-base"
                disabled={busy}
                onClick={() => void tap(checkedIn ? 'check-out' : 'check-in')}
              >
                {busy ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : checkedIn ? (
                  <LogOut className="rtl:rotate-180" aria-hidden />
                ) : (
                  <LogIn className="rtl:rotate-180" aria-hidden />
                )}
                {t(checkedIn ? 'checkOut' : 'checkIn')}
              </Button>
            ) : null}
            <p className="text-xs text-muted-foreground">{t('positionNotice')}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t('selfOff')}</p>
        )}
      </Card>

      <Card className="gap-3 p-4">
        <h2 className="font-semibold">{t('myMonth')}</h2>
        <CountsList counts={d.month.counts} />
        <div className="flex flex-wrap gap-1">
          {d.month.days.map((day) => (
            <DayStatusCell key={day.date} status={day.status} date={day.date} />
          ))}
        </div>
      </Card>

      <Card className="gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">{t('leaveBalance')}</h2>
          <span className="num text-lg font-semibold">{d.leaveBalance}</span>
        </div>
        <Button
          variant="outline"
          className="min-h-11 self-start"
          onClick={() => setLeaveOpen(true)}
        >
          <Plus aria-hidden />
          {t('newLeave')}
        </Button>
      </Card>
      {d.leaves.length > 0 ? (
        <ul className="space-y-2">
          {d.leaves.map((l) => (
            <LeaveRow key={l.id} leave={l} showName={false} />
          ))}
        </ul>
      ) : null}

      <LeaveDialog open={leaveOpen} onOpenChange={setLeaveOpen} />
      <ResponsiveDialog open={needsNote !== null} onOpenChange={(o) => !o && setNeedsNote(null)}>
        <ResponsiveDialogContent className="md:max-w-sm">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t('noteTitle')}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>{t('noteHelp')}</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="self-note">{t('note')}</Label>
            <Input
              id="self-note"
              className="h-11 text-base"
              maxLength={255}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <ResponsiveDialogFooter>
            <Button
              className="min-h-11"
              disabled={self.isPending || !note.trim()}
              onClick={() =>
                needsNote &&
                send(needsNote.kind, {
                  isMocked: false,
                  ...needsNote.geo,
                  note: note.trim(),
                })
              }
            >
              {t('confirm')}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
