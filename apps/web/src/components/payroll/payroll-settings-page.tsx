'use client';

import { ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  Feature,
  PAY_ITEM_MODES,
  type PayItemMode,
  type PayItemTypeDto,
  PAYROLL_DAY_DIVISORS,
  type PayrollSettingsDto,
  Permission,
} from '@erp/shared';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
import { StickyActions } from '@/components/shared/sticky-actions';
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
import { Switch } from '@/components/ui/switch';
import { usePermission } from '@/lib/auth';
import {
  useArchivePayItemType,
  usePayItemTypes,
  usePayrollSettings,
  useSavePayItemType,
  useSavePayrollSettings,
} from '@/lib/payroll';
import { useErrorMessage } from '@/lib/use-error-message';

export function PayrollSettingsPage() {
  return (
    <FeatureGate feature={Feature.PAYROLL}>
      <Settings />
    </FeatureGate>
  );
}

function Settings() {
  const t = useTranslations('payroll');
  const settings = usePayrollSettings();
  const canManage = usePermission(Permission.PAYROLL_MANAGE);
  return (
    <>
      <PageHeader
        title={t('settingsTitle')}
        description={t('settingsSubtitle')}
        more={[{ label: t('back'), icon: ArrowLeft, flipIcon: true, href: '/rh/paie' }]}
      />
      {settings.data ? (
        <SettingsForm initial={settings.data} canManage={canManage} />
      ) : (
        <Skeleton className="h-48 w-full" />
      )}
      <PayItems canManage={canManage} />
    </>
  );
}

function SettingsForm({ initial, canManage }: { initial: PayrollSettingsDto; canManage: boolean }) {
  const t = useTranslations('payroll');
  const errorMessage = useErrorMessage();
  const save = useSavePayrollSettings();
  const [form, setForm] = useState(initial);

  return (
    <Card className="gap-4 p-4">
      <div className="space-y-2">
        <Label htmlFor="pay-divisor">{t('dayDivisor')}</Label>
        <NativeSelect
          id="pay-divisor"
          disabled={!canManage}
          value={form.dayDivisor}
          onChange={(e) =>
            setForm({
              ...form,
              dayDivisor: Number(e.target.value) as PayrollSettingsDto['dayDivisor'],
            })
          }
        >
          {PAYROLL_DAY_DIVISORS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </NativeSelect>
        <p className="text-xs text-muted-foreground">{t('dayDivisorHelp')}</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="pay-hours">{t('hourDivisor')}</Label>
        <Input
          id="pay-hours"
          inputMode="decimal"
          dir="ltr"
          className="h-11 text-base"
          disabled={!canManage}
          value={form.hourDivisor}
          onChange={(e) => setForm({ ...form, hourDivisor: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="pay-overtime">{t('overtimeRate')}</Label>
        <Input
          id="pay-overtime"
          inputMode="decimal"
          dir="ltr"
          className="h-11 text-base"
          disabled={!canManage}
          value={form.overtimeRate}
          onChange={(e) => setForm({ ...form, overtimeRate: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">{t('overtimeRateHelp')}</p>
      </div>
      <div className="flex min-h-11 items-center justify-between gap-3">
        <Label htmlFor="pay-late">{t('deductLateness')}</Label>
        <Switch
          id="pay-late"
          disabled={!canManage}
          checked={form.deductLateness}
          onCheckedChange={(deductLateness) => setForm({ ...form, deductLateness })}
        />
      </div>
      {canManage ? (
        <StickyActions>
          <Button
            className="min-h-11 w-full md:w-auto"
            disabled={save.isPending}
            onClick={() =>
              save.mutate(
                {
                  dayDivisor: form.dayDivisor,
                  hourDivisor: form.hourDivisor,
                  overtimeRate: form.overtimeRate,
                  deductLateness: form.deductLateness,
                },
                {
                  onSuccess: () => toast.success(t('settingsSaved')),
                  onError: (err) => toast.error(errorMessage(err)),
                },
              )
            }
          >
            {t('saveSettings')}
          </Button>
        </StickyActions>
      ) : null}
    </Card>
  );
}

function PayItems({ canManage }: { canManage: boolean }) {
  const t = useTranslations('payroll');
  const errorMessage = useErrorMessage();
  const types = usePayItemTypes();
  const archive = useArchivePayItemType();
  const [editing, setEditing] = useState<PayItemTypeDto | 'new' | null>(null);
  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">{t('payItems')}</h2>
        {canManage ? (
          <Button variant="outline" className="min-h-11" onClick={() => setEditing('new')}>
            <Plus aria-hidden />
            {t('newPayItem')}
          </Button>
        ) : null}
      </div>
      <ul className="divide-y text-sm">
        {(types.data ?? []).map((x) => (
          <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0">
              <span className="block break-words font-medium">{x.name}</span>
              <span className="flex flex-wrap gap-1 pt-1">
                <Badge variant="outline">{t(`mode_${x.mode}`)}</Badge>
                {x.cotisable ? <Badge variant="secondary">{t('cotisable')}</Badge> : null}
                {x.imposable ? <Badge variant="secondary">{t('imposable')}</Badge> : null}
              </span>
            </span>
            {canManage ? (
              <span className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11"
                  aria-label={t('edit')}
                  onClick={() => setEditing(x)}
                >
                  <Pencil aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11"
                  aria-label={t('archive')}
                  disabled={archive.isPending}
                  onClick={() =>
                    archive.mutate(x.id, { onError: (err) => toast.error(errorMessage(err)) })
                  }
                >
                  <Trash2 aria-hidden />
                </Button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {editing ? (
        <PayItemDialog type={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
    </Card>
  );
}

function PayItemDialog({ type, onClose }: { type: PayItemTypeDto | null; onClose: () => void }) {
  const t = useTranslations('payroll');
  const errorMessage = useErrorMessage();
  const save = useSavePayItemType();
  const [name, setName] = useState(type?.name ?? '');
  const [mode, setMode] = useState<PayItemMode>(type?.mode ?? 'FIXED');
  const [cotisable, setCotisable] = useState(type?.cotisable ?? true);
  const [imposable, setImposable] = useState(type?.imposable ?? true);
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent className="md:max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{type ? t('edit') : t('newPayItem')}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="item-name">{t('payItemName')}</Label>
            <Input
              id="item-name"
              className="h-11 text-base"
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="item-mode">{t('payItemMode')}</Label>
            <NativeSelect
              id="item-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as PayItemMode)}
            >
              {PAY_ITEM_MODES.map((m) => (
                <option key={m} value={m}>
                  {t(`mode_${m}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex min-h-11 items-center justify-between gap-3">
            <Label htmlFor="item-cotisable">{t('cotisable')}</Label>
            <Switch id="item-cotisable" checked={cotisable} onCheckedChange={setCotisable} />
          </div>
          <div className="flex min-h-11 items-center justify-between gap-3">
            <Label htmlFor="item-imposable">{t('imposable')}</Label>
            <Switch id="item-imposable" checked={imposable} onCheckedChange={setImposable} />
          </div>
        </div>
        <ResponsiveDialogFooter>
          <Button
            className="min-h-11"
            disabled={save.isPending || name.trim().length === 0}
            onClick={() =>
              save.mutate(
                { id: type?.id ?? null, body: { name: name.trim(), mode, cotisable, imposable } },
                { onSuccess: onClose, onError: (err) => toast.error(errorMessage(err)) },
              )
            }
          >
            {t('saveSettings')}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
