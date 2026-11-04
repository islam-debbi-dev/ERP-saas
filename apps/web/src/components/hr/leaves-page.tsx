'use client';

import { CalendarCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Feature,
  LEAVE_REQUEST_STATUSES,
  type LeaveRequestDto,
  type LeaveRequestStatus,
  Permission,
} from '@erp/shared';
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
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermission } from '@/lib/auth';
import { useDecideLeave, useLeavePages } from '@/lib/hr';
import { useErrorMessage } from '@/lib/use-error-message';
import { HrTabs } from './hr-tabs';

export function LeavesPage() {
  return (
    <FeatureGate feature={Feature.HR}>
      <Leaves />
    </FeatureGate>
  );
}

function Leaves() {
  const t = useTranslations('hr');
  const errorMessage = useErrorMessage();
  const [status, setStatus] = useState<LeaveRequestStatus | ''>('PENDING');
  const pages = useLeavePages(status);
  const items = useMemo(() => pages.data?.pages.flatMap((p) => p.items) ?? [], [pages.data]);

  return (
    <>
      <PageHeader title={t('leavesTitle')} description={t('leavesSubtitle')} />
      <HrTabs />
      <div className="space-y-2 md:max-w-52">
        <Label htmlFor="leave-status">{t('leaveStatus')}</Label>
        <NativeSelect
          id="leave-status"
          value={status}
          onChange={(e) => setStatus(e.target.value as LeaveRequestStatus | '')}
        >
          <option value="">{t('allStatuses')}</option>
          {LEAVE_REQUEST_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`leaveStatus_${s}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      {pages.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : pages.isError ? (
        <EmptyState icon={CalendarCheck} title={errorMessage(pages.error)} />
      ) : items.length === 0 ? (
        <EmptyState icon={CalendarCheck} title={t('noLeaves')} />
      ) : (
        <ul className="space-y-2">
          {items.map((l) => (
            <LeaveRow key={l.id} leave={l} />
          ))}
        </ul>
      )}
      {pages.hasNextPage ? (
        <Button
          variant="outline"
          className="min-h-11 self-center"
          disabled={pages.isFetchingNextPage}
          onClick={() => void pages.fetchNextPage()}
        >
          {t('loadMore')}
        </Button>
      ) : null}
    </>
  );
}

export function LeaveRow({
  leave,
  showName = true,
}: {
  leave: LeaveRequestDto;
  showName?: boolean;
}) {
  const t = useTranslations('hr');
  const errorMessage = useErrorMessage();
  const canDecide = usePermission(Permission.LEAVE_APPROVE);
  const decide = useDecideLeave();
  const [asking, setAsking] = useState<'reject' | 'cancel' | null>(null);
  const [reason, setReason] = useState('');

  const approve = () =>
    decide.mutate(
      { id: leave.id, action: 'approve' },
      {
        onSuccess: (res) =>
          res.overBalance ? toast.warning(t('overBalance')) : toast.success(t('leaveApproved')),
        onError: (err) => toast.error(errorMessage(err)),
      },
    );

  const send = () => {
    if (!asking) return;
    decide.mutate(
      { id: leave.id, action: asking, reason: reason.trim() },
      {
        onSuccess: () => {
          setAsking(null);
          setReason('');
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  return (
    <li>
      <Card className="gap-2 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {showName ? <p className="truncate font-medium">{leave.employee.fullName}</p> : null}
            <p className="text-sm text-muted-foreground">
              {t(`leave_${leave.type}`)}
              {', '}
              <span dir="ltr" className="num">
                {leave.startDate} / {leave.endDate}
              </span>
            </p>
            <p className="text-sm">{t('leaveDays', { n: leave.days })}</p>
            {leave.note ? <p className="text-sm break-words">{leave.note}</p> : null}
            {leave.decisionReason ? (
              <p className="text-sm break-words text-muted-foreground">{leave.decisionReason}</p>
            ) : null}
          </div>
          <Badge variant={leave.status === 'PENDING' ? 'default' : 'outline'}>
            {t(`leaveStatus_${leave.status}`)}
          </Badge>
        </div>
        {canDecide && (leave.status === 'PENDING' || leave.status === 'APPROVED') ? (
          <div className="flex flex-wrap gap-2">
            {leave.status === 'PENDING' ? (
              <>
                <Button className="min-h-11" disabled={decide.isPending} onClick={approve}>
                  {t('approve')}
                </Button>
                <Button
                  variant="outline"
                  className="min-h-11"
                  disabled={decide.isPending}
                  onClick={() => setAsking('reject')}
                >
                  {t('reject')}
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                className="min-h-11"
                disabled={decide.isPending}
                onClick={() => setAsking('cancel')}
              >
                {t('cancelLeave')}
              </Button>
            )}
          </div>
        ) : null}
      </Card>
      <ResponsiveDialog open={asking !== null} onOpenChange={(o) => !o && setAsking(null)}>
        <ResponsiveDialogContent className="md:max-w-sm">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {asking === 'reject' ? t('reject') : t('cancelLeave')}
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`leave-reason-${leave.id}`}>{t('reason')}</Label>
            <Input
              id={`leave-reason-${leave.id}`}
              className="h-11 text-base"
              maxLength={255}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <ResponsiveDialogFooter>
            <Button
              className="min-h-11"
              disabled={decide.isPending || reason.trim().length < 3}
              onClick={send}
            >
              {t('confirm')}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </li>
  );
}
