'use client';

import { CalendarOff, CheckCheck, ChevronLeft, ChevronRight, Clock, Loader2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  type AbsenceReason,
  ABSENCE_REASONS,
  addDays,
  algiersDay,
  type AttendanceDayRowDto,
  type AttendanceMarkInput,
  CORRECTABLE_STATUSES,
  type CorrectableStatus,
  DayStatus,
  Feature,
  Permission,
} from '@erp/shared';
import { EmptyState } from '@/components/shared/empty-state';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
import { StickyActions } from '@/components/shared/sticky-actions';
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
import { usePermission } from '@/lib/auth';
import { useAttendanceDay, useCorrectAttendance, useMarkAttendance } from '@/lib/hr';
import { useErrorMessage } from '@/lib/use-error-message';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';
import { DayStatusBadge } from './day-status';
import { HrTabs } from './hr-tabs';

/** A day that can still take a first mark. A worked rest day needs no correction. */
const OPEN: readonly DayStatus[] = [DayStatus.UNMARKED, DayStatus.REST, DayStatus.HOLIDAY];
const LATE_PRESETS = [15, 30, 60];

export function PointagePage() {
  return (
    <FeatureGate feature={Feature.HR}>
      <Pointage />
    </FeatureGate>
  );
}

/**
 * Pointage du jour: the screen that matters. A manager taps "Tous présents", then fixes
 * the two or three exceptions; 15 workers in under 30 seconds on a phone. The rows are
 * rows of big buttons, not a form: a tap is saved at once.
 */
function Pointage() {
  const t = useTranslations('hr');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const today = algiersDay();
  const [date, setDate] = useState(today);
  const canMark = usePermission(Permission.ATTENDANCE_MARK);
  const canCorrect = usePermission(Permission.ATTENDANCE_CORRECT);
  const day = useAttendanceDay(date);
  const mark = useMarkAttendance();
  const [absent, setAbsent] = useState<AttendanceDayRowDto | null>(null);
  const [late, setLate] = useState<AttendanceDayRowDto | null>(null);
  const [correcting, setCorrecting] = useState<AttendanceDayRowDto | null>(null);

  const rows = day.data?.rows ?? [];
  const unmarked = rows.filter((r) => r.status === DayStatus.UNMARKED);

  const send = (marks: AttendanceMarkInput[], skipMarked = false, done?: () => void) =>
    mark.mutate(
      { date, marks, skipMarked },
      {
        onSuccess: () => done?.(),
        onError: (err) => toast.error(errorMessage(err)),
      },
    );

  return (
    <>
      <PageHeader title={t('todayTitle')} description={t('todaySubtitle')} />
      <HrTabs />

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className="size-11"
          aria-label={t('previousDay')}
          onClick={() => setDate(addDays(date, -1))}
        >
          <ChevronLeft className="rtl:rotate-180" aria-hidden />
        </Button>
        <Label htmlFor="pointage-date" className="sr-only">
          {t('date')}
        </Label>
        <Input
          id="pointage-date"
          type="date"
          className="h-11 min-w-0 flex-1 text-base md:max-w-52"
          max={today}
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
        <Button
          variant="outline"
          size="icon"
          className="size-11"
          aria-label={t('nextDay')}
          disabled={date >= today}
          onClick={() => setDate(addDays(date, 1))}
        >
          <ChevronRight className="rtl:rotate-180" aria-hidden />
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {format.dateTime(new Date(`${date}T12:00:00Z`), { dateStyle: 'full' })}
      </p>

      {day.isPending ? (
        <div className="space-y-2" aria-busy>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : day.isError ? (
        <EmptyState icon={CalendarOff} title={errorMessage(day.error)} />
      ) : day.data.countsOnly ? (
        <Card className="p-4">
          <p className="mb-2 text-sm text-muted-foreground">{t('countsOnly')}</p>
          <ul className="flex flex-wrap gap-2">
            {Object.entries(day.data.counts).map(([status, n]) => (
              <li key={status} className="flex items-center gap-1.5 text-sm">
                <DayStatusBadge status={status as DayStatus} />
                <span className="num">{n}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={CalendarOff}
          title={t('noEmployees')}
          description={t('noEmployeesHelp')}
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <PointageRow
              key={row.employee.id}
              row={row}
              canMark={canMark}
              canCorrect={canCorrect}
              busy={mark.isPending}
              onPresent={() => send([{ employeeId: row.employee.id, kind: 'PRESENT', note: null }])}
              onHalf={() => send([{ employeeId: row.employee.id, kind: 'HALF_DAY', note: null }])}
              onAbsent={() => setAbsent(row)}
              onLate={() => setLate(row)}
              onCorrect={() => setCorrecting(row)}
            />
          ))}
        </ul>
      )}

      {canMark && rows.length > 0 ? (
        <StickyActions>
          <Button
            size="lg"
            className="min-h-12 w-full md:w-auto"
            disabled={mark.isPending || unmarked.length === 0}
            onClick={() =>
              send(
                unmarked.map((r) => ({
                  employeeId: r.employee.id,
                  kind: 'PRESENT' as const,
                  note: null,
                })),
                true,
              )
            }
          >
            {mark.isPending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <CheckCheck aria-hidden />
            )}
            {t('allPresent', { n: unmarked.length })}
          </Button>
        </StickyActions>
      ) : null}

      <AbsenceSheet
        row={absent}
        busy={mark.isPending}
        onClose={() => setAbsent(null)}
        onPick={(absenceReason) =>
          absent &&
          send(
            [{ employeeId: absent.employee.id, kind: 'ABSENT', absenceReason, note: null }],
            false,
            () => setAbsent(null),
          )
        }
      />
      <LateSheet
        row={late}
        busy={mark.isPending}
        onClose={() => setLate(null)}
        onPick={(lateMinutes) =>
          late &&
          send(
            [{ employeeId: late.employee.id, kind: 'LATE', lateMinutes, note: null }],
            false,
            () => setLate(null),
          )
        }
      />
      <CorrectionSheet row={correcting} date={date} onClose={() => setCorrecting(null)} />
    </>
  );
}

function PointageRow({
  row,
  canMark,
  canCorrect,
  busy,
  onPresent,
  onHalf,
  onAbsent,
  onLate,
  onCorrect,
}: {
  row: AttendanceDayRowDto;
  canMark: boolean;
  canCorrect: boolean;
  busy: boolean;
  onPresent: () => void;
  onHalf: () => void;
  onAbsent: () => void;
  onLate: () => void;
  onCorrect: () => void;
}) {
  const t = useTranslations('hr');
  const open = OPEN.includes(row.status);
  return (
    <li>
      <Card className="gap-3 p-3" data-testid="pointage-row">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium" title={row.employee.fullName}>
              {row.employee.fullName}
            </p>
            {row.employee.position ? (
              <p className="truncate text-xs text-muted-foreground">{row.employee.position}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {row.lateMinutes > 0 ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="size-3.5" aria-hidden />
                {t('lateMinutes', { n: row.lateMinutes })}
              </span>
            ) : null}
            <DayStatusBadge status={row.status} />
          </div>
        </div>
        {open && canMark ? (
          <div className="grid grid-cols-4 gap-2">
            <Button className="min-h-12 px-1" disabled={busy} onClick={onPresent}>
              {t('markPresent')}
            </Button>
            <Button variant="outline" className="min-h-12 px-1" disabled={busy} onClick={onAbsent}>
              {t('markAbsent')}
            </Button>
            <Button
              variant="outline"
              className="min-h-12 px-1"
              disabled={busy}
              aria-label={t('markHalfLabel')}
              onClick={onHalf}
            >
              ½
            </Button>
            <Button variant="outline" className="min-h-12 px-1" disabled={busy} onClick={onLate}>
              {t('markLate')}
            </Button>
          </div>
        ) : !open && canCorrect ? (
          <Button variant="ghost" size="sm" className="min-h-11 self-start" onClick={onCorrect}>
            {t('correct')}
          </Button>
        ) : null}
      </Card>
    </li>
  );
}

function AbsenceSheet({
  row,
  busy,
  onClose,
  onPick,
}: {
  row: AttendanceDayRowDto | null;
  busy: boolean;
  onClose: () => void;
  onPick: (reason: AbsenceReason) => void;
}) {
  const t = useTranslations('hr');
  return (
    <ResponsiveDialog open={row !== null} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent className="md:max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('absenceTitle')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{row?.employee.fullName}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="grid gap-2">
          {ABSENCE_REASONS.map((reason) => (
            <Button
              key={reason}
              variant="outline"
              className="min-h-12 justify-start"
              disabled={busy}
              onClick={() => onPick(reason)}
            >
              {t(`absence_${reason}`)}
            </Button>
          ))}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function LateSheet({
  row,
  busy,
  onClose,
  onPick,
}: {
  row: AttendanceDayRowDto | null;
  busy: boolean;
  onClose: () => void;
  onPick: (minutes: number) => void;
}) {
  const t = useTranslations('hr');
  const [custom, setCustom] = useState('');
  const minutes = Number(custom);
  const valid = Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440;
  return (
    <ResponsiveDialog open={row !== null} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent className="md:max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('lateTitle')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{row?.employee.fullName}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="grid grid-cols-3 gap-2">
          {LATE_PRESETS.map((m) => (
            <Button
              key={m}
              variant="outline"
              className="min-h-12"
              disabled={busy}
              onClick={() => onPick(m)}
            >
              {t('lateMinutes', { n: m })}
            </Button>
          ))}
        </div>
        <div className="space-y-2">
          <Label htmlFor="late-minutes">{t('lateCustom')}</Label>
          <div className="flex gap-2">
            <Input
              id="late-minutes"
              inputMode="numeric"
              className="h-11 text-base"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
            <Button className="min-h-11" disabled={busy || !valid} onClick={() => onPick(minutes)}>
              {t('save')}
            </Button>
          </div>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function CorrectionSheet({
  row,
  date,
  onClose,
}: {
  row: AttendanceDayRowDto | null;
  date: string;
  onClose: () => void;
}) {
  const t = useTranslations('hr');
  const errorMessage = useErrorMessage();
  const correct = useCorrectAttendance();
  const key = useIdempotencyKey(row !== null);
  const [to, setTo] = useState<CorrectableStatus>(DayStatus.PRESENT);
  const [reason, setReason] = useState('');

  const submit = () => {
    if (!row) return;
    correct.mutate(
      { key, employeeId: row.employee.id, date, correctedTo: to, reason: reason.trim() },
      {
        onSuccess: () => {
          setReason('');
          toast.success(t('corrected'));
          onClose();
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  return (
    <ResponsiveDialog open={row !== null} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent className="md:max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('correctTitle')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{t('correctHelp')}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {row?.events.length ? (
          <ul className="space-y-1 rounded-md bg-muted p-3 text-xs">
            {row.events.map((e) => (
              <li key={e.id}>
                {t(`event_${e.kind}`)}
                {e.note ? `: ${e.note}` : ''}
                {e.createdBy ? ` (${e.createdBy.fullName})` : ''}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="correct-to">{t('correctTo')}</Label>
          <NativeSelect
            id="correct-to"
            value={to}
            onChange={(e) => setTo(e.target.value as CorrectableStatus)}
          >
            {CORRECTABLE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status_${s}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="correct-reason">{t('correctReason')}</Label>
          <Input
            id="correct-reason"
            className="h-11 text-base"
            maxLength={255}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <ResponsiveDialogFooter>
          <Button
            className="min-h-11"
            disabled={correct.isPending || reason.trim().length < 3}
            onClick={submit}
          >
            {t('correctSave')}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
