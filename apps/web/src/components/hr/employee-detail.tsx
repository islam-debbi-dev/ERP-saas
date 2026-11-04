'use client';

import { Archive, ArrowLeft, Pencil, Plus, UserX } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  algiersDay,
  type EmployeeDto,
  type EmployeeLedgerEntryDto,
  Feature,
  PAY_TYPES,
  PAYMENT_MODES,
  type PaymentMode,
  type PayType,
  Permission,
} from '@erp/shared';
import { Amount } from '@/components/shared/amount';
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
import { usePermission } from '@/lib/auth';
import { useCancelExpense } from '@/lib/expenses';
import {
  useAddSalary,
  useArchiveEmployee,
  useEmployee,
  useEmployeeLedger,
  useLeaveBalance,
  usePayAdvance,
  useRefreshHr,
  useSalaries,
} from '@/lib/hr';
import { useErrorMessage } from '@/lib/use-error-message';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';
import { EmployeeDialog } from './employee-dialog';
import { LeaveDialog } from './leave-dialog';

export function EmployeeDetailPage({ id }: { id: string }) {
  return (
    <FeatureGate feature={Feature.HR}>
      <Detail id={id} />
    </FeatureGate>
  );
}

function Detail({ id }: { id: string }) {
  const t = useTranslations('hr');
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const employee = useEmployee(id);
  const canManage = usePermission(Permission.HR_MANAGE);
  const canPay = usePermission(Permission.SALARY_VIEW);
  const archive = useArchiveEmployee();
  const [editing, setEditing] = useState(false);

  if (employee.isPending) return <Skeleton className="h-64 w-full" />;
  if (employee.isError) {
    return <EmptyState icon={UserX} title={errorMessage(employee.error)} />;
  }
  const e = employee.data;

  return (
    <>
      <PageHeader
        title={e.fullName}
        description={e.position ?? undefined}
        more={[
          { label: t('back'), icon: ArrowLeft, flipIcon: true, href: '/rh/employes' },
          canManage && { label: t('editEmployee'), icon: Pencil, onSelect: () => setEditing(true) },
          canManage && {
            label: t('archive'),
            icon: Archive,
            onSelect: () =>
              archive.mutate(e.id, {
                onSuccess: () => router.push('/rh/employes'),
                onError: (err) => toast.error(errorMessage(err)),
              }),
          },
        ]}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Infos e={e} />
        <Leave employeeId={e.id} />
        {canPay ? <Salaries employeeId={e.id} canAdd={canManage} /> : null}
        {canPay ? <Advances e={e} /> : null}
      </div>
      <EmployeeDialog open={editing} employee={e} onOpenChange={setEditing} />
    </>
  );
}

function Infos({ e }: { e: EmployeeDto }) {
  const t = useTranslations('hr');
  const rows: [string, string | null | undefined][] = [
    [t('matricule'), e.matricule],
    [t('phone'), e.phone],
    [t('depot'), e.warehouse?.name],
    [t('hireDate'), e.hireDate],
    [t('exitDate'), e.exitDate],
    [t('contract'), t(`contract_${e.contract}`)],
    [t('contractEnd'), e.contractEndDate],
    [t('declared'), e.declared ? t('declaredYes') : t('declaredNo')],
    [t('nss'), e.nss],
    [t('nin'), e.nin],
    [t('birthDate'), e.birthDate],
    [t('linkedUser'), e.user?.fullName],
    [t('bankAccount'), e.pay?.bankAccount],
  ];
  return (
    <Card className="gap-3 p-4">
      <h2 className="font-semibold">{t('infos')}</h2>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label} className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 truncate text-end" title={value ?? undefined}>
                {value}
              </dd>
            </div>
          ))}
      </dl>
    </Card>
  );
}

function Leave({ employeeId }: { employeeId: string }) {
  const t = useTranslations('hr');
  const balance = useLeaveBalance(employeeId);
  const [open, setOpen] = useState(false);
  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">{t('leaveBalance')}</h2>
        <span className="num text-lg font-semibold">{balance.data?.balance ?? ''}</span>
      </div>
      <ul className="max-h-48 divide-y overflow-y-auto text-sm">
        {(balance.data?.entries ?? []).map((l) => (
          <li key={l.id} className="flex justify-between gap-2 py-1.5">
            <span className="min-w-0 truncate">
              {t(`leaveEntry_${l.type}`)}
              {l.month ? ` ${l.month}` : ''}
            </span>
            <span dir="ltr" className="num">
              {l.days}
            </span>
          </li>
        ))}
      </ul>
      <Button variant="outline" className="min-h-11 self-start" onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        {t('newLeave')}
      </Button>
      <LeaveDialog open={open} employeeId={employeeId} onOpenChange={setOpen} />
    </Card>
  );
}

function Salaries({ employeeId, canAdd }: { employeeId: string; canAdd: boolean }) {
  const t = useTranslations('hr');
  const errorMessage = useErrorMessage();
  const rows = useSalaries(employeeId, true);
  const add = useAddSalary(employeeId);
  const [open, setOpen] = useState(false);
  const key = useIdempotencyKey(open);
  const [amount, setAmount] = useState('');
  const [payType, setPayType] = useState<PayType>('MONTHLY');
  const [effectiveFrom, setFrom] = useState(algiersDay());
  const [reason, setReason] = useState('');

  const submit = () =>
    add.mutate(
      { key, body: { amount, payType, effectiveFrom, reason: reason.trim() || null } },
      {
        onSuccess: () => {
          setAmount('');
          setReason('');
          setOpen(false);
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );

  return (
    <Card className="gap-3 p-4">
      <h2 className="font-semibold">{t('salaryHistory')}</h2>
      <ul className="divide-y text-sm">
        {(rows.data ?? []).map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2 py-1.5">
            <span className="min-w-0 truncate">
              <span dir="ltr" className="num">
                {s.effectiveFrom}
              </span>{' '}
              {t(`pay_${s.payType}`)}
              {s.reason ? `, ${s.reason}` : ''}
            </span>
            <Amount value={s.amount} />
          </li>
        ))}
      </ul>
      {canAdd ? (
        <Button variant="outline" className="min-h-11 self-start" onClick={() => setOpen(true)}>
          <Plus aria-hidden />
          {t('newSalary')}
        </Button>
      ) : null}
      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent className="md:max-w-sm">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t('newSalary')}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>{t('newSalaryHelp')}</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="salary-amount">{t('salary')}</Label>
              <Input
                id="salary-amount"
                inputMode="decimal"
                className="h-11 text-base"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="salary-type">{t('payType')}</Label>
              <NativeSelect
                id="salary-type"
                value={payType}
                onChange={(e) => setPayType(e.target.value as PayType)}
              >
                {PAY_TYPES.map((p) => (
                  <option key={p} value={p}>
                    {t(`pay_${p}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="salary-from">{t('effectiveFrom')}</Label>
              <Input
                id="salary-from"
                type="date"
                className="h-11 text-base"
                value={effectiveFrom}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="salary-reason">{t('reason')}</Label>
              <Input
                id="salary-reason"
                className="h-11 text-base"
                maxLength={255}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button className="min-h-11" disabled={add.isPending || !amount} onClick={submit}>
              {t('save')}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </Card>
  );
}

function Advances({ e }: { e: EmployeeDto }) {
  const t = useTranslations('hr');
  const ts = useTranslations('expenses');
  const errorMessage = useErrorMessage();
  const canPay = usePermission(Permission.ADVANCE_PAY);
  const canCancel = usePermission(Permission.EXPENSE_CANCEL);
  const ledger = useEmployeeLedger(e.id, true);
  const pay = usePayAdvance(e.id);
  const [open, setOpen] = useState(false);
  const key = useIdempotencyKey(open);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<PaymentMode>('ESPECES');
  const [note, setNote] = useState('');
  const [cancelling, setCancelling] = useState<EmployeeLedgerEntryDto | null>(null);

  const items = ledger.data?.items ?? [];
  const reversed = new Set(items.filter((i) => i.type === 'REVERSAL').map((i) => i.expenseId));

  const submit = () =>
    pay.mutate(
      { key, body: { amount, mode, note: note.trim() || null, reference: null } },
      {
        onSuccess: () => {
          toast.success(t('advancePaid'));
          setAmount('');
          setNote('');
          setOpen(false);
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );

  return (
    <Card className="gap-3 p-4 lg:col-span-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">{t('advanceBalance')}</h2>
        <Amount value={ledger.data?.balance ?? e.pay?.advanceBalance ?? '0'} />
      </div>
      <ul className="divide-y text-sm">
        {items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <span className="min-w-0 break-words">
              {t(`ledger_${i.type}`)}
              {i.expenseNumber ? (
                <>
                  {' '}
                  <span dir="ltr" className="num">
                    {i.expenseNumber}
                  </span>
                </>
              ) : null}
              {i.note ? `, ${i.note}` : ''}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <Amount value={i.amount} />
              {canCancel && i.type === 'ADVANCE' && i.expenseId && !reversed.has(i.expenseId) ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-11"
                  onClick={() => setCancelling(i)}
                >
                  {t('cancelAdvance')}
                </Button>
              ) : null}
              {reversed.has(i.expenseId) && i.type === 'ADVANCE' ? (
                <Badge variant="outline">{ts('statusCANCELLED')}</Badge>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {canPay ? (
        <Button className="min-h-11 self-start" onClick={() => setOpen(true)}>
          <Plus aria-hidden />
          {t('newAdvance')}
        </Button>
      ) : null}
      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent className="md:max-w-sm">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t('newAdvance')}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>{e.fullName}</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="advance-amount">{t('amount')}</Label>
              <Input
                id="advance-amount"
                inputMode="decimal"
                className="h-11 text-base"
                value={amount}
                onChange={(ev) => setAmount(ev.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="advance-mode">{t('mode')}</Label>
              <NativeSelect
                id="advance-mode"
                value={mode}
                onChange={(ev) => setMode(ev.target.value as PaymentMode)}
              >
                {PAYMENT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {t(`mode_${m}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="advance-note">{t('note')}</Label>
              <Input
                id="advance-note"
                className="h-11 text-base"
                maxLength={255}
                value={note}
                onChange={(ev) => setNote(ev.target.value)}
              />
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button className="min-h-11" disabled={pay.isPending || !amount} onClick={submit}>
              {t('payAdvance')}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
      <CancelAdvance entry={cancelling} onClose={() => setCancelling(null)} />
    </Card>
  );
}

function CancelAdvance({
  entry,
  onClose,
}: {
  entry: EmployeeLedgerEntryDto | null;
  onClose: () => void;
}) {
  const t = useTranslations('hr');
  const errorMessage = useErrorMessage();
  const cancel = useCancelExpense();
  const key = useIdempotencyKey(entry !== null);
  const [reason, setReason] = useState('');
  const refresh = useRefreshHr();

  const submit = () => {
    if (!entry?.expenseId) return;
    cancel.mutate(
      { id: entry.expenseId, reason: reason.trim(), key },
      {
        onSuccess: () => {
          refresh();
          setReason('');
          onClose();
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  return (
    <ResponsiveDialog open={entry !== null} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent className="md:max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('cancelAdvance')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{t('cancelAdvanceHelp')}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="advance-cancel-reason">{t('reason')}</Label>
          <Input
            id="advance-cancel-reason"
            className="h-11 text-base"
            maxLength={255}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <ResponsiveDialogFooter>
          <Button
            className="min-h-11"
            disabled={cancel.isPending || reason.trim().length < 3}
            onClick={submit}
          >
            {t('confirm')}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
