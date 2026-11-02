'use client';

import { Banknote, CalendarX, Home, Loader2, Pencil, Phone, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  Permission,
  RENT_PERIODS,
  type RentContractDto,
  type RentPeriod,
  parseDA,
} from '@erp/shared';
import { Amount } from '@/components/shared/amount';
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
import { useCloseRentContract, useRentContracts, useSaveRentContract } from '@/lib/expenses';
import { todayInAlgiers } from '@/lib/purchases';
import { useErrorMessage } from '@/lib/use-error-message';
import { DayText } from './day-text';
import { ExpenseDialog } from './expense-dialog';

/**
 * Loyer of a dépôt (phase 25): its current contracts, paid until, next due and what is
 * due, with a pay button that prefills the expense. `warehouseId` '' = every dépôt.
 */
export function RentBlock({ warehouseId }: { warehouseId: string }) {
  const t = useTranslations('expenses');
  const contracts = useRentContracts(warehouseId);
  const canManage = usePermission(Permission.RENT_MANAGE);
  const [editing, setEditing] = useState<RentContractDto | 'new' | null>(null);
  const current = (contracts.data ?? []).filter((c) => !c.ended);
  const past = (contracts.data ?? []).filter((c) => c.ended);

  return (
    <Card className="gap-0 p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 p-4 pb-2">
        <div className="min-w-0">
          <h2 className="font-semibold">{t('rentTitle')}</h2>
          <p className="text-xs text-muted-foreground">{t('rentHelp')}</p>
        </div>
        {canManage ? (
          <Button
            variant="outline"
            size="sm"
            className="min-h-11"
            onClick={() => setEditing('new')}
          >
            <Plus aria-hidden />
            {t('newContract')}
          </Button>
        ) : null}
      </div>
      {contracts.isPending ? (
        <div className="p-4" aria-busy>
          <Skeleton className="h-24 w-full" />
        </div>
      ) : current.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground">{t('noContract')}</p>
      ) : (
        <ul className="divide-y">
          {current.map((c) => (
            <ContractRow key={c.id} contract={c} onEdit={() => setEditing(c)} />
          ))}
        </ul>
      )}
      {past.length > 0 ? (
        <details className="border-t px-4 py-3 text-sm">
          <summary className="min-h-11 cursor-pointer content-center text-muted-foreground">
            {t('pastContracts', { count: past.length })}
          </summary>
          <ul className="mt-2 space-y-1">
            {past.map((c) => (
              <li key={c.id} className="flex flex-wrap justify-between gap-2">
                <span className="min-w-0 truncate">{c.landlordName}</span>
                <span className="text-muted-foreground">
                  <DayText day={c.startDate} /> → {c.endDate ? <DayText day={c.endDate} /> : null}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {editing ? (
        <ContractDialog
          contract={editing === 'new' ? null : editing}
          warehouseId={warehouseId}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Card>
  );
}

function ContractRow({ contract: c, onEdit }: { contract: RentContractDto; onEdit: () => void }) {
  const t = useTranslations('expenses');
  const canPay = usePermission(Permission.EXPENSES_CREATE);
  const canManage = usePermission(Permission.RENT_MANAGE);
  const [paying, setPaying] = useState(false);
  const [closing, setClosing] = useState(false);
  const due = parseDA(c.amountDue)?.gt(0) ?? false;

  return (
    <li className="grid grid-cols-[minmax(0,1fr)] gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium" title={c.landlordName}>
            <Home className="me-1 inline size-4 text-muted-foreground" aria-hidden />
            {c.landlordName}
          </p>
          <p className="text-sm text-muted-foreground">
            <Amount value={c.amount} /> / {t(`period${c.period}`)}
            {c.landlordPhone ? (
              <a
                href={`tel:${c.landlordPhone.replace(/\s/g, '')}`}
                className="ms-2 inline-flex items-center gap-1 underline-offset-4 hover:underline"
                dir="ltr"
              >
                <Phone className="size-3.5" aria-hidden />
                {c.landlordPhone}
              </a>
            ) : null}
          </p>
          {c.warehouse ? <p className="text-xs text-muted-foreground">{c.warehouse.name}</p> : null}
        </div>
        <div className="flex flex-wrap gap-1">
          {c.alerts.includes('UNPAID_DUE') ? (
            <Badge variant="destructive">{t('alertUNPAID_DUE')}</Badge>
          ) : null}
          {c.alerts.includes('ENDING_SOON') ? (
            <Badge variant="outline">{t('alertENDING_SOON')}</Badge>
          ) : null}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">{t('paidUntil')}</dt>
          <dd className="font-medium">
            {c.paidUntil ? <DayText day={c.paidUntil} /> : t('notPaidYet')}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t('nextDue')}</dt>
          <dd className="font-medium">{c.nextDueDate ? <DayText day={c.nextDueDate} /> : '—'}</dd>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <dt className="text-xs text-muted-foreground">{t('amountDue')}</dt>
          <dd className={due ? 'font-semibold text-destructive' : 'font-medium'}>
            <Amount value={c.amountDue} />
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2">
        {canPay && c.nextDueDate ? (
          <Button className="min-h-11 max-sm:flex-1" onClick={() => setPaying(true)}>
            <Banknote aria-hidden />
            {t('payRent')}
          </Button>
        ) : null}
        {canManage && !c.locked ? (
          <Button variant="outline" className="min-h-11" onClick={onEdit}>
            <Pencil aria-hidden />
            {t('editContract')}
          </Button>
        ) : null}
        {canManage ? (
          <Button variant="ghost" className="min-h-11" onClick={() => setClosing(true)}>
            <CalendarX aria-hidden />
            {t('closeContract')}
          </Button>
        ) : null}
      </div>
      {paying ? <ExpenseDialog open rent={c} onOpenChange={(o) => !o && setPaying(false)} /> : null}
      {closing ? <CloseDialog contract={c} onClose={() => setClosing(false)} /> : null}
    </li>
  );
}

function ContractDialog({
  contract,
  warehouseId,
  onClose,
}: {
  contract: RentContractDto | null;
  warehouseId: string;
  onClose: () => void;
}) {
  const t = useTranslations('expenses');
  const errorMessage = useErrorMessage();
  const save = useSaveRentContract();
  const [landlordName, setLandlordName] = useState(contract?.landlordName ?? '');
  const [landlordPhone, setLandlordPhone] = useState(contract?.landlordPhone ?? '');
  const [amount, setAmount] = useState(contract?.amount ?? '');
  const [period, setPeriod] = useState<RentPeriod>(contract?.period ?? 'MONTHLY');
  const [startDate, setStartDate] = useState(contract?.startDate ?? todayInAlgiers());
  const [endDate, setEndDate] = useState(contract?.endDate ?? '');
  const [note, setNote] = useState(contract?.note ?? '');
  const value = parseDA(amount);
  const valid =
    landlordName.trim() !== '' &&
    value !== null &&
    value.gt(0) &&
    value.decimalPlaces() <= 2 &&
    startDate !== '' &&
    (endDate === '' || endDate >= startDate);
  const depot = contract?.warehouse.id ?? warehouseId;

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent className="md:max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid || save.isPending) return;
            save.mutate(
              {
                id: contract?.id ?? null,
                body: {
                  ...(depot ? { warehouseId: depot } : {}),
                  landlordName: landlordName.trim(),
                  landlordPhone: landlordPhone.trim() || null,
                  amount: value.toString(),
                  period,
                  startDate,
                  endDate: endDate || null,
                  note: note.trim() || null,
                },
              },
              {
                onSuccess: () => {
                  toast.success(t('contractSaved'));
                  onClose();
                },
                onError: (err) => toast.error(errorMessage(err)),
              },
            );
          }}
        >
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {contract ? t('editContract') : t('newContract')}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>{t('contractHelp')}</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="rc-landlord">{t('landlord')}</Label>
              <Input
                id="rc-landlord"
                maxLength={120}
                value={landlordName}
                onChange={(e) => setLandlordName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rc-phone">{t('landlordPhone')}</Label>
              <Input
                id="rc-phone"
                dir="ltr"
                inputMode="tel"
                maxLength={30}
                value={landlordPhone}
                onChange={(e) => setLandlordPhone(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rc-amount">{t('rentAmount')}</Label>
              <Input
                id="rc-amount"
                dir="ltr"
                inputMode="decimal"
                className="num"
                aria-invalid={amount !== '' && (value === null || !value.gt(0))}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rc-period">{t('period')}</Label>
              <NativeSelect
                id="rc-period"
                value={period}
                onChange={(e) => setPeriod(e.target.value as RentPeriod)}
              >
                {RENT_PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {t(`period${p}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rc-start">{t('startDate')}</Label>
              <Input
                id="rc-start"
                type="date"
                dir="ltr"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rc-end">{t('endDateOptional')}</Label>
              <Input
                id="rc-end"
                type="date"
                dir="ltr"
                min={startDate || undefined}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="rc-note">{t('note')}</Label>
              <Input
                id="rc-note"
                maxLength={255}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('cancelButton')}
            </Button>
            <Button type="submit" disabled={!valid || save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t('save')}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function CloseDialog({ contract, onClose }: { contract: RentContractDto; onClose: () => void }) {
  const t = useTranslations('expenses');
  const errorMessage = useErrorMessage();
  const close = useCloseRentContract();
  const [endDate, setEndDate] = useState(contract.paidUntil ?? todayInAlgiers());
  const tooEarly = contract.paidUntil !== null && endDate < contract.paidUntil;
  const valid = endDate !== '' && endDate >= contract.startDate && !tooEarly;

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent className="md:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid || close.isPending) return;
            close.mutate(
              { id: contract.id, body: { endDate } },
              {
                onSuccess: () => {
                  toast.success(t('contractClosed'));
                  onClose();
                },
                onError: (err) => toast.error(errorMessage(err)),
              },
            );
          }}
        >
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t('closeContract')}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>{t('closeHelp')}</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rc-close">{t('lastDay')}</Label>
            <Input
              id="rc-close"
              type="date"
              dir="ltr"
              min={contract.paidUntil ?? contract.startDate}
              aria-invalid={!valid}
              aria-describedby={tooEarly ? 'rc-close-error' : undefined}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
            {tooEarly && contract.paidUntil ? (
              <p id="rc-close-error" className="text-sm text-destructive">
                {t('closeTooEarly')} <DayText day={contract.paidUntil} />
              </p>
            ) : null}
          </div>
          <ResponsiveDialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('cancelButton')}
            </Button>
            <Button type="submit" variant="destructive" disabled={!valid || close.isPending}>
              {close.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t('closeContract')}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
