'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  algiersDay,
  EMPLOYEE_CONTRACTS,
  type EmployeeContract,
  type EmployeeDto,
  EmployeeContract as Contract,
  Feature,
  PAY_TYPES,
  type PayType,
  Permission,
  WarehouseType,
} from '@erp/shared';
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
import { Switch } from '@/components/ui/switch';
import { useFeature, usePermission } from '@/lib/auth';
import { useSaveEmployee } from '@/lib/hr';
import { useWarehouses } from '@/lib/stock';
import { useErrorMessage } from '@/lib/use-error-message';
import { useUsers } from '@/lib/users';

interface Form {
  fullName: string;
  phone: string;
  position: string;
  warehouseId: string;
  userId: string;
  hireDate: string;
  exitDate: string;
  contract: EmployeeContract;
  contractEndDate: string;
  declared: boolean;
  nss: string;
  nin: string;
  birthDate: string;
  bankAccount: string;
  salary: string;
  payType: PayType;
}

function initial(e: EmployeeDto | null): Form {
  return {
    fullName: e?.fullName ?? '',
    phone: e?.phone ?? '',
    position: e?.position ?? '',
    warehouseId: e?.warehouse?.id ?? '',
    userId: e?.user?.id ?? '',
    hireDate: e?.hireDate ?? algiersDay(),
    exitDate: e?.exitDate ?? '',
    contract: e?.contract ?? Contract.CDI,
    contractEndDate: e?.contractEndDate ?? '',
    declared: e?.declared ?? false,
    nss: e?.nss ?? '',
    nin: e?.nin ?? '',
    birthDate: e?.birthDate ?? '',
    bankAccount: e?.pay?.bankAccount ?? '',
    salary: '',
    payType: 'MONTHLY',
  };
}

/** Create or edit an employee. Pay fields only exist for a user with SALARY_VIEW. */
export function EmployeeDialog({
  open,
  employee,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  employee: EmployeeDto | null;
  onOpenChange: (open: boolean) => void;
  onSaved?: (e: EmployeeDto) => void;
}) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="md:max-w-xl">
        {open ? (
          <EmployeeForm
            employee={employee}
            onDone={(e) => {
              onSaved?.(e);
              onOpenChange(false);
            }}
          />
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function EmployeeForm({
  employee,
  onDone,
}: {
  employee: EmployeeDto | null;
  onDone: (e: EmployeeDto) => void;
}) {
  const t = useTranslations('hr');
  const errorMessage = useErrorMessage();
  const save = useSaveEmployee();
  const multiUnit = useFeature(Feature.MULTI_UNIT);
  const canPay = usePermission(Permission.SALARY_VIEW);
  const canUsers = usePermission(Permission.USERS_VIEW);
  const depots = (useWarehouses().data ?? []).filter((w) => w.type !== WarehouseType.VEHICLE);
  const users = useUsers(canUsers);
  const [f, setF] = useState<Form>(() => initial(employee));
  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setF((v) => ({ ...v, [key]: value }));

  const needsDepot = multiUnit && !f.warehouseId;
  const needsEnd = f.contract === Contract.CDD && !f.contractEndDate;
  const invalid = !f.fullName.trim() || !f.hireDate || needsDepot || needsEnd;

  const submit = () => {
    const body = {
      fullName: f.fullName,
      phone: f.phone || null,
      position: f.position || null,
      warehouseId: f.warehouseId || null,
      userId: f.userId || null,
      hireDate: f.hireDate,
      exitDate: f.exitDate || null,
      contract: f.contract,
      contractEndDate: f.contractEndDate || null,
      declared: f.declared,
      nss: f.nss || null,
      nin: f.nin || null,
      birthDate: f.birthDate || null,
      bankAccount: f.bankAccount || null,
      restDays: employee?.restDays ?? null,
      ...(!employee && canPay && f.salary
        ? {
            salary: {
              amount: f.salary,
              payType: f.payType,
              effectiveFrom: f.hireDate,
              reason: null,
            },
          }
        : {}),
    };
    save.mutate(
      { id: employee?.id ?? null, body },
      {
        onSuccess: (saved) => {
          toast.success(t('employeeSaved'));
          onDone(saved);
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  const field = (id: keyof Form, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-2">
      <Label htmlFor={`emp-${id}`}>{label}</Label>
      <Input
        id={`emp-${id}`}
        className="h-11 text-base"
        value={f[id] as string}
        onChange={(e) => set(id, e.target.value as never)}
        {...props}
      />
    </div>
  );

  return (
    <>
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>
          {employee ? t('editEmployee') : t('newEmployee')}
        </ResponsiveDialogTitle>
      </ResponsiveDialogHeader>
      <div className="grid gap-4 md:grid-cols-2">
        {field('fullName', t('fullName'), { maxLength: 120, autoFocus: true })}
        {field('position', t('position'), { maxLength: 80 })}
        {field('phone', t('phone'), { inputMode: 'tel', maxLength: 40 })}
        <div className="space-y-2">
          <Label htmlFor="emp-depot">{t('depot')}</Label>
          <NativeSelect
            id="emp-depot"
            value={f.warehouseId}
            onChange={(e) => set('warehouseId', e.target.value)}
          >
            <option value="">{t('noDepot')}</option>
            {depots.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        {field('hireDate', t('hireDate'), { type: 'date' })}
        {field('exitDate', t('exitDate'), { type: 'date' })}
        <div className="space-y-2">
          <Label htmlFor="emp-contract">{t('contract')}</Label>
          <NativeSelect
            id="emp-contract"
            value={f.contract}
            onChange={(e) => set('contract', e.target.value as EmployeeContract)}
          >
            {EMPLOYEE_CONTRACTS.map((c) => (
              <option key={c} value={c}>
                {t(`contract_${c}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        {f.contract === Contract.CDD
          ? field('contractEndDate', t('contractEnd'), { type: 'date' })
          : null}
        {canUsers ? (
          <div className="space-y-2">
            <Label htmlFor="emp-user">{t('linkedUser')}</Label>
            <NativeSelect
              id="emp-user"
              value={f.userId}
              onChange={(e) => set('userId', e.target.value)}
            >
              <option value="">{t('noUser')}</option>
              {(users.data ?? [])
                .filter((u) => u.active)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
            </NativeSelect>
          </div>
        ) : null}
        {field('birthDate', t('birthDate'), { type: 'date' })}
        {field('nss', t('nss'), { maxLength: 30 })}
        {field('nin', t('nin'), { maxLength: 30 })}
        <div className="flex min-h-11 items-center justify-between gap-3 md:col-span-2">
          <Label htmlFor="emp-declared">{t('declared')}</Label>
          <Switch
            id="emp-declared"
            checked={f.declared}
            onCheckedChange={(v) => set('declared', v)}
          />
        </div>
        {canPay ? field('bankAccount', t('bankAccount'), { maxLength: 40 }) : null}
        {canPay && !employee ? (
          <>
            {field('salary', t('salary'), { inputMode: 'decimal' })}
            <div className="space-y-2">
              <Label htmlFor="emp-pay">{t('payType')}</Label>
              <NativeSelect
                id="emp-pay"
                value={f.payType}
                onChange={(e) => set('payType', e.target.value as PayType)}
              >
                {PAY_TYPES.map((p) => (
                  <option key={p} value={p}>
                    {t(`pay_${p}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </>
        ) : null}
      </div>
      <ResponsiveDialogFooter>
        <Button className="min-h-11" disabled={save.isPending || invalid} onClick={submit}>
          {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {t('save')}
        </Button>
      </ResponsiveDialogFooter>
    </>
  );
}
