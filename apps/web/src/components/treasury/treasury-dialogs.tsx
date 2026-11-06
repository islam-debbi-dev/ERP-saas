'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  CASH_ACCOUNT_TYPES,
  type CashAccountDto,
  type CashAccountType,
  countEcart,
  formatDA,
  money,
  parseDA,
  WarehouseType,
} from '@erp/shared';
import { Amount } from '@/components/shared/amount';
import { Button } from '@/components/ui/button';
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
import { todayInAlgiers } from '@/lib/purchases';
import { useWarehouses } from '@/lib/stock';
import {
  useCancelTransfer,
  useCashCount,
  useCashOpening,
  useSaveCashAccount,
  useTransfer,
} from '@/lib/treasury';
import { useErrorMessage } from '@/lib/use-error-message';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';
import { isolateLtr } from '@/lib/utils';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function Shell({
  open,
  onOpenChange,
  title,
  help,
  submit,
  canSubmit,
  busy,
  onSubmit,
  children,
}: DialogProps & {
  title: string;
  help: string;
  submit: string;
  canSubmit: boolean;
  busy: boolean;
  onSubmit: () => void;
  children: React.ReactNode;
}) {
  const tc = useTranslations('common');
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="md:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit && !busy) onSubmit();
          }}
        >
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>{help}</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          {children}
          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit || busy}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {submit}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function AmountField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        dir="ltr"
        inputMode="decimal"
        autoComplete="off"
        className="num"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

const twoDecimals = (v: ReturnType<typeof parseDA>) => v !== null && v.decimalPlaces() <= 2;

/** Versement de la caisse en banque, retrait: from one account to another. */
export function TransferDialog({
  accounts,
  from: initialFrom,
  open,
  onOpenChange,
}: DialogProps & { accounts: CashAccountDto[]; from?: string }) {
  const t = useTranslations('treasury');
  const errorMessage = useErrorMessage();
  const key = useIdempotencyKey(open);
  const transfer = useTransfer();
  const [from, setFrom] = useState(initialFrom ?? accounts[0]?.id ?? '');
  const [to, setTo] = useState(
    accounts.find((a) => a.id !== (initialFrom ?? accounts[0]?.id))?.id ?? '',
  );
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const value = parseDA(amount);
  const source = accounts.find((a) => a.id === from);
  const tooMuch = value !== null && source?.balance ? value.gt(source.balance) : false;
  const valid = value !== null && value.gt(0) && twoDecimals(value);

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      title={t('transferTitle')}
      help={t('transferHelp')}
      submit={t('transferSubmit')}
      canSubmit={valid && !tooMuch && from !== '' && to !== '' && from !== to}
      busy={transfer.isPending}
      onSubmit={() =>
        transfer.mutate(
          {
            key,
            body: { fromAccountId: from, toAccountId: to, amount: value?.toString(), note },
          },
          {
            onSuccess: (r) => {
              toast.success(t('transferDone', { number: r.number }));
              onOpenChange(false);
            },
            onError: (err) => toast.error(errorMessage(err)),
          },
        )
      }
    >
      <div className="space-y-2">
        <Label htmlFor="trf-from">{t('from')}</Label>
        <NativeSelect id="trf-from" value={from} onChange={(e) => setFrom(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </NativeSelect>
        {source?.balance ? (
          <p className="text-sm text-muted-foreground">
            {t('available')} <Amount value={source.balance} />
          </p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="trf-to">{t('to')}</Label>
        <NativeSelect id="trf-to" value={to} onChange={(e) => setTo(e.target.value)}>
          {accounts
            .filter((a) => a.id !== from)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </NativeSelect>
      </div>
      <AmountField id="trf-amount" label={t('amount')} value={amount} onChange={setAmount} />
      {tooMuch ? (
        <p role="alert" className="text-sm text-destructive">
          {t('tooMuch')}
        </p>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="trf-note">{t('note')}</Label>
        <Input
          id="trf-note"
          value={note}
          maxLength={255}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </Shell>
  );
}

/** Comptage de caisse: what is in the till against the books. */
export function CountDialog({
  account,
  open,
  onOpenChange,
}: DialogProps & { account: CashAccountDto }) {
  const t = useTranslations('treasury');
  const errorMessage = useErrorMessage();
  const key = useIdempotencyKey(open);
  const count = useCashCount(account.id);
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState('');
  const value = parseDA(counted);
  const valid = value !== null && !value.isNegative() && twoDecimals(value);
  const ecart = valid ? countEcart(value, account.balance ?? '0') : null;
  const needsReason = ecart !== null && !ecart.isZero();

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      title={t('countTitle', { name: account.name })}
      help={t('countHelp')}
      submit={t('countSubmit')}
      canSubmit={valid && (!needsReason || reason.trim().length >= 3)}
      busy={count.isPending}
      onSubmit={() =>
        count.mutate(
          { key, body: { counted: value?.toString(), reason: needsReason ? reason : '' } },
          {
            onSuccess: (r) => {
              toast.success(
                money(r.ecart).isZero()
                  ? t('countOk')
                  : t('countAdjusted', { ecart: isolateLtr(formatDA(r.ecart)) }),
              );
              onOpenChange(false);
            },
            onError: (err) => toast.error(errorMessage(err)),
          },
        )
      }
    >
      <p className="text-sm text-muted-foreground">
        {t('expected')} <Amount value={account.balance ?? '0'} />
      </p>
      <AmountField id="count-amount" label={t('counted')} value={counted} onChange={setCounted} />
      {ecart ? (
        <p className="text-sm font-medium" aria-live="polite">
          {t('ecart')} <Amount value={ecart} />
        </p>
      ) : null}
      {needsReason ? (
        <div className="space-y-2">
          <Label htmlFor="count-reason">{t('reason')}</Label>
          <Input
            id="count-reason"
            value={reason}
            maxLength={255}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      ) : null}
    </Shell>
  );
}

/** Solde initial: entered once, at a date the owner chooses. */
export function OpeningDialog({
  account,
  open,
  onOpenChange,
}: DialogProps & { account: CashAccountDto }) {
  const t = useTranslations('treasury');
  const errorMessage = useErrorMessage();
  const key = useIdempotencyKey(open);
  const opening = useCashOpening(account.id);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayInAlgiers);
  const value = parseDA(amount);
  const valid = value !== null && twoDecimals(value) && date !== '' && date <= todayInAlgiers();

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      title={t('openingTitle', { name: account.name })}
      help={t('openingHelp')}
      submit={t('openingSubmit')}
      canSubmit={valid}
      busy={opening.isPending}
      onSubmit={() =>
        opening.mutate(
          { key, body: { amount: value?.toString(), date } },
          {
            onSuccess: () => {
              toast.success(t('openingDone'));
              onOpenChange(false);
            },
            onError: (err) => toast.error(errorMessage(err)),
          },
        )
      }
    >
      <AmountField id="opening-amount" label={t('amount')} value={amount} onChange={setAmount} />
      <div className="space-y-2">
        <Label htmlFor="opening-date">{t('openingDate')}</Label>
        <Input
          id="opening-date"
          type="date"
          value={date}
          max={todayInAlgiers()}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
    </Shell>
  );
}

/** A new account, or the name, bank and default of an existing one. */
export function AccountDialog({
  account,
  open,
  onOpenChange,
}: DialogProps & { account: CashAccountDto | null }) {
  const t = useTranslations('treasury');
  const errorMessage = useErrorMessage();
  const save = useSaveCashAccount(account?.id ?? null);
  const warehouses = useWarehouses();
  const depots = (warehouses.data ?? []).filter((w) => w.type !== WarehouseType.VEHICLE);
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<CashAccountType>(account?.type ?? 'CAISSE');
  const [warehouseId, setWarehouseId] = useState('');
  const [bankName, setBankName] = useState(account?.bankName ?? '');
  const [rib, setRib] = useState(account?.rib ?? '');
  const [isDefault, setIsDefault] = useState(account?.isDefault ?? false);

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      title={account ? t('editAccount') : t('newAccount')}
      help={t('accountHelp')}
      submit={t('saveAccount')}
      canSubmit={name.trim().length >= 2}
      busy={save.isPending}
      onSubmit={() =>
        save.mutate(
          account
            ? { name, bankName, rib, isDefault, version: account.version }
            : { name, type, warehouseId: warehouseId || null, bankName, rib, isDefault },
          {
            onSuccess: () => onOpenChange(false),
            onError: (err) => toast.error(errorMessage(err)),
          },
        )
      }
    >
      <div className="space-y-2">
        <Label htmlFor="acc-name">{t('accountName')}</Label>
        <Input
          id="acc-name"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      {account ? null : (
        <>
          <div className="space-y-2">
            <Label htmlFor="acc-type">{t('accountType')}</Label>
            <NativeSelect
              id="acc-type"
              value={type}
              onChange={(e) => setType(e.target.value as CashAccountType)}
            >
              {CASH_ACCOUNT_TYPES.map((v) => (
                <option key={v} value={v}>
                  {t(`type_${v}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          {depots.length > 0 ? (
            <div className="space-y-2">
              <Label htmlFor="acc-depot">{t('depot')}</Label>
              <NativeSelect
                id="acc-depot"
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
              >
                <option value="">{t('noDepot')}</option>
                {depots.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
        </>
      )}
      {(account?.type ?? type) === 'CAISSE' ? null : (
        <>
          <div className="space-y-2">
            <Label htmlFor="acc-bank">{t('bankName')}</Label>
            <Input
              id="acc-bank"
              value={bankName}
              maxLength={80}
              onChange={(e) => setBankName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="acc-rib">{t('rib')}</Label>
            <Input
              id="acc-rib"
              dir="ltr"
              inputMode="numeric"
              className="num"
              value={rib}
              maxLength={30}
              onChange={(e) => setRib(e.target.value)}
            />
          </div>
        </>
      )}
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="size-5"
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
        />
        {t('isDefault')}
      </label>
    </Shell>
  );
}

export function CancelTransferDialog({
  transferId,
  open,
  onOpenChange,
}: DialogProps & { transferId: string }) {
  const t = useTranslations('treasury');
  const errorMessage = useErrorMessage();
  const key = useIdempotencyKey(open);
  const cancel = useCancelTransfer();
  const [reason, setReason] = useState('');
  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      title={t('cancelTransferTitle')}
      help={t('cancelTransferHelp')}
      submit={t('cancelTransfer')}
      canSubmit={reason.trim().length >= 3}
      busy={cancel.isPending}
      onSubmit={() =>
        cancel.mutate(
          { id: transferId, key, reason },
          {
            onSuccess: () => onOpenChange(false),
            onError: (err) => toast.error(errorMessage(err)),
          },
        )
      }
    >
      <div className="space-y-2">
        <Label htmlFor="trf-reason">{t('reason')}</Label>
        <Input
          id="trf-reason"
          value={reason}
          maxLength={255}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
    </Shell>
  );
}
