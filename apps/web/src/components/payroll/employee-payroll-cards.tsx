'use client';

import { FileText } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { algiersDay, Permission } from '@erp/shared';
import { Amount } from '@/components/shared/amount';
import { usePrint } from '@/components/shared/print-button';
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
import { usePermission } from '@/lib/auth';
import {
  monthName,
  useAddEmployeePayItem,
  useEmployeePayItems,
  useEmployeePayslips,
  usePayItemTypes,
  usePayrollOn,
} from '@/lib/payroll';
import { useErrorMessage } from '@/lib/use-error-message';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';

/** On the employee fiche, with the module and SALARY_VIEW. */
export function EmployeePayrollCards({ employeeId }: { employeeId: string }) {
  const on = usePayrollOn();
  if (!on) return null;
  return (
    <>
      <Payslips employeeId={employeeId} />
      <PayItems employeeId={employeeId} />
    </>
  );
}

function Payslips({ employeeId }: { employeeId: string }) {
  const t = useTranslations('payroll');
  const locale = useLocale();
  const slips = useEmployeePayslips(employeeId, true);
  const { print, busy } = usePrint();
  return (
    <Card className="gap-3 p-4">
      <h2 className="font-semibold">{t('payslipsTitle')}</h2>
      {slips.data?.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noPayslips')}</p>
      ) : null}
      <ul className="divide-y text-sm">
        {slips.data?.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2 py-1">
            <span className="min-w-0 truncate">{monthName(s.month, locale)}</span>
            <span className="flex shrink-0 items-center gap-1">
              <Amount value={s.netToPay} />
              <Button
                variant="ghost"
                size="icon"
                className="size-11"
                disabled={busy}
                aria-label={s.declared ? t('printBulletin') : t('printRecu')}
                onClick={() =>
                  void print(
                    `/payroll-runs/payslips/${s.id}/pdf`,
                    s.declared ? 'A4' : 'A5',
                    `paie-${s.month}.pdf`,
                  )
                }
              >
                <FileText aria-hidden />
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PayItems({ employeeId }: { employeeId: string }) {
  const t = useTranslations('payroll');
  const canManage = usePermission(Permission.PAYROLL_MANAGE);
  const items = useEmployeePayItems(employeeId, true);
  const [open, setOpen] = useState(false);
  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">{t('recurringItems')}</h2>
        {canManage ? (
          <Button variant="outline" className="min-h-11" onClick={() => setOpen(true)}>
            {t('addRecurring')}
          </Button>
        ) : null}
      </div>
      {items.data?.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noRecurring')}</p>
      ) : null}
      <ul className="divide-y text-sm">
        {items.data?.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <span className="min-w-0 break-words">
              {i.typeName}{' '}
              <bdi dir="ltr" className="num text-muted-foreground">
                {i.effectiveFrom}
              </bdi>
            </span>
            <Amount value={i.amount} />
          </li>
        ))}
      </ul>
      <AddItemDialog employeeId={employeeId} open={open} onOpenChange={setOpen} />
    </Card>
  );
}

function AddItemDialog({
  employeeId,
  open,
  onOpenChange,
}: {
  employeeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('payroll');
  const errorMessage = useErrorMessage();
  const add = useAddEmployeePayItem(employeeId);
  const types = usePayItemTypes(open);
  const key = useIdempotencyKey(open);
  const [typeId, setTypeId] = useState('');
  const [amount, setAmount] = useState('');
  const [effectiveFrom, setFrom] = useState(`${algiersDay().slice(0, 7)}-01`);
  const type = typeId || types.data?.[0]?.id || '';
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="md:max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('addRecurring')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{t('addRecurringHelp')}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rec-type">{t('payItem')}</Label>
            <NativeSelect id="rec-type" value={type} onChange={(e) => setTypeId(e.target.value)}>
              {(types.data ?? []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor="rec-amount">{t('amount')}</Label>
            <Input
              id="rec-amount"
              inputMode="decimal"
              dir="ltr"
              className="h-11 text-base"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rec-from">{t('effectiveFrom')}</Label>
            <Input
              id="rec-from"
              type="date"
              className="h-11 text-base"
              value={effectiveFrom}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
        </div>
        <ResponsiveDialogFooter>
          <Button
            className="min-h-11"
            disabled={add.isPending || !amount || !type || !effectiveFrom}
            onClick={() =>
              add.mutate(
                { key, body: { typeId: type, amount, effectiveFrom } },
                {
                  onSuccess: () => {
                    setAmount('');
                    onOpenChange(false);
                  },
                  onError: (err) => toast.error(errorMessage(err)),
                },
              )
            }
          >
            {t('addRecurring')}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
