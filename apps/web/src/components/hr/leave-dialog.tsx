'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { algiersDay, LEAVE_TYPES, type LeaveType } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { useRequestLeave } from '@/lib/hr';
import { useErrorMessage } from '@/lib/use-error-message';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';

/** A leave request: for `employeeId`, or for the signed-in user when left out. */
export function LeaveDialog({
  open,
  employeeId,
  onOpenChange,
}: {
  open: boolean;
  employeeId?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('hr');
  const errorMessage = useErrorMessage();
  const request = useRequestLeave();
  const key = useIdempotencyKey(open);
  const today = algiersDay();
  const [startDate, setStart] = useState(today);
  const [endDate, setEnd] = useState(today);
  const [type, setType] = useState<LeaveType>('PAID');
  const [note, setNote] = useState('');

  const submit = () =>
    request.mutate(
      {
        key,
        body: {
          ...(employeeId ? { employeeId } : {}),
          startDate,
          endDate,
          type,
          note: note.trim() || null,
        },
      },
      {
        onSuccess: () => {
          toast.success(t('leaveRequested'));
          setNote('');
          onOpenChange(false);
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="md:max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('newLeave')}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="leave-type">{t('leaveType')}</Label>
            <NativeSelect
              id="leave-type"
              value={type}
              onChange={(e) => setType(e.target.value as LeaveType)}
            >
              {LEAVE_TYPES.map((l) => (
                <option key={l} value={l}>
                  {t(`leave_${l}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0 space-y-2">
              <Label htmlFor="leave-start">{t('from')}</Label>
              <Input
                id="leave-start"
                type="date"
                className="h-11 text-base"
                value={startDate}
                onChange={(e) => {
                  setStart(e.target.value);
                  if (e.target.value > endDate) setEnd(e.target.value);
                }}
              />
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor="leave-end">{t('to')}</Label>
              <Input
                id="leave-end"
                type="date"
                className="h-11 text-base"
                min={startDate}
                value={endDate}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="leave-note">{t('note')}</Label>
            <Input
              id="leave-note"
              className="h-11 text-base"
              maxLength={255}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <ResponsiveDialogFooter>
          <Button
            className="min-h-11"
            disabled={request.isPending || !startDate || !endDate}
            onClick={submit}
          >
            {t('sendRequest')}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
