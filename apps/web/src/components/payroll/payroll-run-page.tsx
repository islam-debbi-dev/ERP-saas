'use client';

import {
  ArrowLeft,
  Banknote,
  Download,
  FileText,
  RefreshCw,
  TriangleAlert,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  BLOCKING_PAYSLIP_ISSUES,
  Feature,
  money,
  PAYMENT_MODES,
  type PaymentMode,
  type PayrollManualKind,
  type PayrollRunDetailDto,
  type PayslipDto,
  Permission,
} from '@erp/shared';
import { CashAccountPicker } from '@/components/treasury/cash-account-picker';
import { Amount } from '@/components/shared/amount';
import { EmptyState } from '@/components/shared/empty-state';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
import { usePrint } from '@/components/shared/print-button';
import { StickyActions } from '@/components/shared/sticky-actions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import {
  downloadPayrollFile,
  monthName,
  usePayItemTypes,
  usePayrollRun,
  usePayrollRunActions,
} from '@/lib/payroll';
import { useErrorMessage } from '@/lib/use-error-message';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';
import { PayslipLines } from './payslip-lines';

export function PayrollRunPage({ id }: { id: string }) {
  return (
    <FeatureGate feature={Feature.PAYROLL}>
      <Run id={id} />
    </FeatureGate>
  );
}

function Run({ id }: { id: string }) {
  const t = useTranslations('payroll');
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const query = usePayrollRun(id);
  const actions = usePayrollRunActions(id);
  const canManage = usePermission(Permission.PAYROLL_MANAGE);
  const canApprove = usePermission(Permission.PAYROLL_APPROVE);
  const canPay = usePermission(Permission.PAYROLL_PAY);
  const canExport = usePermission(Permission.EXPORT_DATA);
  const { print } = usePrint();
  const [slipId, setSlipId] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  if (query.isPending) return <Skeleton className="h-64 w-full" />;
  if (query.isError) return <EmptyState icon={XCircle} title={errorMessage(query.error)} />;
  const run = query.data;
  const draft = run.status === 'DRAFT';
  const approved = run.status === 'APPROVED';
  const slip = run.payslips.find((p) => p.id === slipId) ?? null;
  const blocked = run.payslips.some((p) =>
    p.issues.some((i) => BLOCKING_PAYSLIP_ISSUES.includes(i.code)),
  );
  const fail = (err: unknown) => toast.error(errorMessage(err));
  const exportFile = (name: string, label: string) => () =>
    void downloadPayrollFile(
      `/payroll-runs/${id}/${name}.xlsx`,
      `${label}-${run.month}.xlsx`,
    ).catch(fail);

  return (
    <>
      <PageHeader
        title={monthName(run.month, locale)}
        description={run.warehouse?.name ?? t('wholeCompany')}
        more={[
          { label: t('back'), icon: ArrowLeft, flipIcon: true, href: '/rh/paie' },
          draft &&
            canManage && {
              label: t('recompute'),
              icon: RefreshCw,
              onSelect: () =>
                actions.recompute.mutate(undefined, {
                  onSuccess: () => toast.success(t('recomputed')),
                  onError: fail,
                }),
            },
          approved && {
            label: t('printAll'),
            icon: FileText,
            onSelect: () =>
              void print(`/payroll-runs/${id}/pdf`, 'A4', `${run.number ?? 'paie'}.pdf`),
          },
          approved &&
            canExport && {
              label: t('exportLivre'),
              icon: Download,
              onSelect: exportFile('livre-de-paie', 'livre-de-paie'),
            },
          approved &&
            canExport && {
              label: t('exportCnas'),
              icon: Download,
              onSelect: exportFile('etat-cnas', 'etat-cnas'),
            },
          approved &&
            canExport && {
              label: t('exportIrg'),
              icon: Download,
              onSelect: exportFile('recap-irg', 'recap-irg'),
            },
          approved &&
            canExport && {
              label: t('exportDas'),
              icon: Download,
              onSelect: () =>
                void downloadPayrollFile(
                  `/payroll-runs/das.xlsx?year=${run.month.slice(0, 4)}`,
                  `das-${run.month.slice(0, 4)}.xlsx`,
                ).catch(fail),
            },
          (draft ? canManage : approved && canApprove) && {
            label: t('cancelRun'),
            icon: XCircle,
            onSelect: () => setCancelling(true),
          },
        ]}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={approved ? 'secondary' : 'outline'}>{t(`status_${run.status}`)}</Badge>
        {run.number ? (
          <bdi dir="ltr" className="num text-sm text-muted-foreground">
            {run.number}
          </bdi>
        ) : null}
      </div>
      <Notices run={run} />
      <Totals run={run} />
      {draft && canManage ? <ManualLines run={run} /> : null}
      {run.payslips.length === 0 ? (
        <EmptyState icon={Banknote} title={t('nobody')} description={t('nobodyHelp')} />
      ) : null}
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {run.payslips.map((p) => (
          <li key={p.id}>
            <SlipCard slip={p} approved={approved} onOpen={() => setSlipId(p.id)} />
          </li>
        ))}
      </ul>
      {draft && canApprove ? (
        <StickyActions>
          <Button
            className="min-h-11 w-full md:w-auto"
            disabled={
              blocked ||
              !run.ratesConfirmed ||
              actions.approve.isPending ||
              run.payslips.length === 0
            }
            onClick={() =>
              actions.approve.mutate(run.version, {
                onSuccess: () => toast.success(t('approved')),
                onError: fail,
              })
            }
          >
            {t('approve')}
          </Button>
        </StickyActions>
      ) : null}
      {approved && canPay && money(run.totals.remaining).gt(0) ? (
        <StickyActions>
          <Button className="min-h-11 w-full md:w-auto" onClick={() => setPaying(true)}>
            <Banknote aria-hidden />
            {t('pay')}
          </Button>
        </StickyActions>
      ) : null}
      <SlipDialog run={run} slip={slip} onClose={() => setSlipId(null)} />
      <PayDialog run={run} open={paying} onOpenChange={setPaying} />
      <CancelDialog run={run} open={cancelling} onOpenChange={setCancelling} />
    </>
  );
}

/** What stops the approval first, then what the owner should know. */
function Notices({ run }: { run: PayrollRunDetailDto }) {
  const t = useTranslations('payroll');
  const names = (code: string) =>
    run.payslips.filter((p) => p.issues.some((i) => i.code === code)).map((p) => p.fullName);
  const live = run.status === 'DRAFT';
  const unmarked = live ? names('UNMARKED_DAYS') : [];
  const noSalary = live ? names('NO_SALARY') : [];
  const negative = live ? names('NEGATIVE_NET') : [];
  const belowSnmg = live ? names('BELOW_SNMG') : [];
  const credit = live ? names('ADVANCE_CREDIT') : [];
  const blocking: [string, string[]][] = [
    [t('issueUnmarked'), unmarked],
    [t('issueNoSalary'), noSalary],
    [t('issueNegative'), negative],
  ];
  const warnings: [string, string[]][] = [
    [t('issueBelowSnmg'), belowSnmg],
    [t('issueAdvanceCredit'), credit],
    [t('issueNoEmployee'), run.incentivesWithoutEmployee.map((i) => i.fullName)],
  ];
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{t('ratesResponsibility')}</p>
      {blocking
        .filter(([, who]) => who.length > 0)
        .map(([title, who]) => (
          <Alert key={title} variant="destructive">
            <TriangleAlert aria-hidden />
            <AlertTitle>{title}</AlertTitle>
            <AlertDescription className="break-words">{who.join(', ')}</AlertDescription>
          </Alert>
        ))}
      {!run.ratesConfirmed && run.status === 'DRAFT' ? (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertTitle>{t('ratesNotConfirmed')}</AlertTitle>
          <AlertDescription>
            {t('ratesNotConfirmedHelp')}{' '}
            <Link href="/rh/paie/taux" className="inline-flex min-h-11 items-center underline">
              {t('ratesConfirm')}
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}
      {run.rateSetToVerify ? (
        <Alert>
          <TriangleAlert aria-hidden />
          <AlertTitle>{t('ratesToVerify')}</AlertTitle>
          <AlertDescription>{t('ratesToVerifyHelp')}</AlertDescription>
        </Alert>
      ) : null}
      {money(run.manualSalaryExpenses).gt(0) ? (
        <Alert>
          <TriangleAlert aria-hidden />
          <AlertTitle>{t('manualSalaries')}</AlertTitle>
          <AlertDescription>
            {t('manualSalariesHelp')} <Amount value={run.manualSalaryExpenses} />
          </AlertDescription>
        </Alert>
      ) : null}
      {warnings
        .filter(([, who]) => who.length > 0)
        .map(([title, who]) => (
          <Alert key={title}>
            <TriangleAlert aria-hidden />
            <AlertTitle>{title}</AlertTitle>
            <AlertDescription className="break-words">{who.join(', ')}</AlertDescription>
          </Alert>
        ))}
    </div>
  );
}

function Totals({ run }: { run: PayrollRunDetailDto }) {
  const t = useTranslations('payroll');
  const rows: [string, string][] = [
    [t('gross'), run.totals.gross],
    [t('cnasEmployee'), run.totals.cnasEmployee],
    [t('irg'), run.totals.irg],
    [t('employerCost'), run.totals.employerCost],
  ];
  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm text-muted-foreground">{t('netToPay')}</span>
        <Amount value={run.totals.netToPay} className="text-2xl font-bold" />
      </div>
      {run.status === 'APPROVED' ? (
        <dl className="grid grid-cols-2 gap-x-4 text-sm">
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t('paid')}</dt>
            <dd>
              <Amount value={run.totals.paid} />
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t('remaining')}</dt>
            <dd>
              <Amount value={run.totals.remaining} />
            </dd>
          </div>
        </dl>
      ) : null}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2">
            <dt className="min-w-0 truncate text-muted-foreground">{label}</dt>
            <dd>
              <Amount value={value} />
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function SlipCard({
  slip,
  approved,
  onOpen,
}: {
  slip: PayslipDto;
  approved: boolean;
  onOpen: () => void;
}) {
  const t = useTranslations('payroll');
  const blocked = slip.issues.some((i) => BLOCKING_PAYSLIP_ISSUES.includes(i.code));
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full rounded-xl text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="gap-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate font-medium">{slip.fullName}</span>
          {blocked ? (
            <Badge variant="destructive">{t('toFix')}</Badge>
          ) : !slip.declared ? (
            <Badge variant="outline">{t('undeclared')}</Badge>
          ) : null}
        </div>
        <Amount value={slip.netToPay} className="text-xl font-bold" />
        <dl className="grid grid-cols-1 gap-y-0.5 text-sm text-muted-foreground">
          <div className="flex justify-between gap-2">
            <dt>{t('gross')}</dt>
            <dd>
              <Amount value={slip.gross} />
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>{t('deductions')}</dt>
            <dd>
              <Amount
                value={money(slip.cnasEmployee)
                  .add(money(slip.irg))
                  .add(money(slip.retenues))
                  .toFixed(2)}
              />
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>{t('advances')}</dt>
            <dd>
              <Amount value={slip.advanceDeducted} />
            </dd>
          </div>
          {approved ? (
            <div className="flex justify-between gap-2">
              <dt>{t('remaining')}</dt>
              <dd>
                <Amount value={slip.remaining} />
              </dd>
            </div>
          ) : null}
        </dl>
      </Card>
    </button>
  );
}

function SlipDialog({
  run,
  slip,
  onClose,
}: {
  run: PayrollRunDetailDto;
  slip: PayslipDto | null;
  onClose: () => void;
}) {
  const t = useTranslations('payroll');
  const { print, busy } = usePrint();
  return (
    <ResponsiveDialog open={slip !== null} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent className="md:max-w-md">
        {slip ? (
          <>
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>{slip.fullName}</ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                {t('daysPresent', { days: slip.days.present })}
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            <PayslipLines slip={slip} />
            {run.status === 'APPROVED' ? (
              <ResponsiveDialogFooter>
                <Button
                  variant="outline"
                  className="min-h-11"
                  disabled={busy}
                  onClick={() =>
                    void print(
                      `/payroll-runs/payslips/${slip.id}/pdf`,
                      slip.declared ? 'A4' : 'A5',
                      `paie-${slip.matricule}-${slip.month}.pdf`,
                    )
                  }
                >
                  <FileText aria-hidden />
                  {slip.declared ? t('printBulletin') : t('printRecu')}
                </Button>
              </ResponsiveDialogFooter>
            ) : null}
          </>
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/** One-off primes, régularisations and retenues of a draft. */
function ManualLines({ run }: { run: PayrollRunDetailDto }) {
  const t = useTranslations('payroll');
  const errorMessage = useErrorMessage();
  const { patch } = usePayrollRunActions(run.id);
  const [open, setOpen] = useState(false);
  const nameOf = (id: string) => run.payslips.find((p) => p.employeeId === id)?.fullName ?? '';
  return (
    <Card className="gap-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">{t('manualLines')}</h2>
        <Button
          variant="outline"
          className="min-h-11"
          disabled={run.payslips.length === 0}
          onClick={() => setOpen(true)}
        >
          {t('addLine')}
        </Button>
      </div>
      {run.manualLines.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noManualLines')}</p>
      ) : (
        <ul className="divide-y text-sm">
          {run.manualLines.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span className="min-w-0 break-words">
                {nameOf(m.employeeId)}: {m.label}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Amount value={m.amount} />
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-11"
                  disabled={patch.isPending}
                  onClick={() =>
                    patch.mutate(
                      { remove: [m.id] },
                      { onError: (err) => toast.error(errorMessage(err)) },
                    )
                  }
                >
                  {t('remove')}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <ManualLineDialog run={run} open={open} onOpenChange={setOpen} />
    </Card>
  );
}

function ManualLineDialog({
  run,
  open,
  onOpenChange,
}: {
  run: PayrollRunDetailDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('payroll');
  const errorMessage = useErrorMessage();
  const { patch } = usePayrollRunActions(run.id);
  const types = usePayItemTypes(open);
  const [kind, setKind] = useState<PayrollManualKind>('ITEM');
  const [employeeId, setEmployeeId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const employee = employeeId || run.payslips[0]?.employeeId || '';
  const type = typeId || types.data?.[0]?.id || '';

  const submit = () => {
    const line =
      kind === 'ITEM'
        ? { kind, employeeId: employee, typeId: type, amount, note }
        : kind === 'RETENUE'
          ? { kind, employeeId: employee, amount, note }
          : { kind, employeeId: employee, amount, note, cotisable: true, imposable: true };
    patch.mutate(
      { add: [line] },
      {
        onSuccess: () => {
          setAmount('');
          setNote('');
          onOpenChange(false);
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="md:max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('addLine')}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="line-employee">{t('employee')}</Label>
            <NativeSelect
              id="line-employee"
              value={employee}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              {run.payslips.map((p) => (
                <option key={p.employeeId} value={p.employeeId}>
                  {p.fullName}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor="line-kind">{t('lineKind')}</Label>
            <NativeSelect
              id="line-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as PayrollManualKind)}
            >
              <option value="ITEM">{t('kind_ITEM')}</option>
              <option value="REGULARISATION">{t('kind_REGULARISATION')}</option>
              <option value="RETENUE">{t('kind_RETENUE')}</option>
            </NativeSelect>
          </div>
          {kind === 'ITEM' ? (
            <div className="space-y-2">
              <Label htmlFor="line-type">{t('payItem')}</Label>
              <NativeSelect id="line-type" value={type} onChange={(e) => setTypeId(e.target.value)}>
                {(types.data ?? []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="line-amount">{t('amount')}</Label>
            <Input
              id="line-amount"
              inputMode={kind === 'REGULARISATION' ? 'text' : 'decimal'}
              dir="ltr"
              className="h-11 text-base"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {kind === 'REGULARISATION' ? (
              <p className="text-xs text-muted-foreground">{t('regularisationHelp')}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="line-note">{t('note')}</Label>
            <Input
              id="line-note"
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
            disabled={patch.isPending || !amount || (kind !== 'ITEM' && note.trim().length === 0)}
            onClick={submit}
          >
            {t('addLine')}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function PayDialog({
  run,
  open,
  onOpenChange,
}: {
  run: PayrollRunDetailDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('payroll');
  const tp = useTranslations('hr');
  const errorMessage = useErrorMessage();
  const { pay } = usePayrollRunActions(run.id);
  const key = useIdempotencyKey(open);
  const [mode, setMode] = useState<PaymentMode>('ESPECES');
  const [cashAccountId, setCashAccountId] = useState('');
  const [reference, setReference] = useState('');
  const [left, setLeft] = useState<Set<string>>(new Set());
  const due = run.payslips.filter((p) => money(p.remaining).gt(0));
  const chosen = due.filter((p) => !left.has(p.employeeId));
  const total = chosen.reduce((n, p) => n.add(money(p.remaining)), money(0));

  const toggle = (id: string) =>
    setLeft((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = () =>
    pay.mutate(
      {
        key,
        body: {
          mode,
          ...(cashAccountId ? { cashAccountId } : {}),
          reference: reference.trim() || null,
          items: chosen.map((p) => ({ employeeId: p.employeeId })),
        },
      },
      {
        onSuccess: () => {
          toast.success(t('paidDone'));
          setLeft(new Set());
          onOpenChange(false);
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="md:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('pay')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{t('payHelp')}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pay-mode">{t('payMode')}</Label>
            <NativeSelect
              id="pay-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as PaymentMode)}
            >
              {PAYMENT_MODES.map((m) => (
                <option key={m} value={m}>
                  {tp(`mode_${m}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <CashAccountPicker
            id="pay-account"
            mode={mode}
            value={cashAccountId}
            onChange={setCashAccountId}
          />
          <div className="space-y-2">
            <Label htmlFor="pay-reference">{t('reference')}</Label>
            <Input
              id="pay-reference"
              className="h-11 text-base"
              maxLength={80}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
          <ul className="max-h-64 divide-y overflow-y-auto text-sm">
            {due.map((p) => (
              <li key={p.employeeId}>
                <label className="flex min-h-11 items-center gap-3 py-1">
                  <input
                    type="checkbox"
                    className="size-5 shrink-0"
                    checked={!left.has(p.employeeId)}
                    onChange={() => toggle(p.employeeId)}
                  />
                  <span className="min-w-0 flex-1 truncate">{p.fullName}</span>
                  <Amount value={p.remaining} className="shrink-0" />
                </label>
              </li>
            ))}
          </ul>
        </div>
        <ResponsiveDialogFooter>
          <Button
            className="min-h-11"
            disabled={pay.isPending || chosen.length === 0}
            onClick={submit}
          >
            {t('payAmount')} <Amount value={total.toFixed(2)} />
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function CancelDialog({
  run,
  open,
  onOpenChange,
}: {
  run: PayrollRunDetailDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('payroll');
  const errorMessage = useErrorMessage();
  const { cancel } = usePayrollRunActions(run.id);
  const [reason, setReason] = useState('');
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="md:max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('cancelRun')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{t('cancelRunHelp')}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="run-cancel-reason">{t('reason')}</Label>
          <Input
            id="run-cancel-reason"
            className="h-11 text-base"
            maxLength={255}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <ResponsiveDialogFooter>
          <Button
            variant="destructive"
            className="min-h-11"
            disabled={cancel.isPending || reason.trim().length < 3}
            onClick={() =>
              cancel.mutate(reason.trim(), {
                onSuccess: () => onOpenChange(false),
                onError: (err) => toast.error(errorMessage(err)),
              })
            }
          >
            {t('cancelRun')}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
