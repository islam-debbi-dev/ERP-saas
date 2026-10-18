'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Controller, type FieldErrors, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import {
  formatDA,
  Role,
  type TenantSettings,
  type TenantSettingsResponse,
  tenantSettingsSchema,
} from '@erp/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { useErrorMessage } from '@/lib/use-error-message';
import { cn } from '@/lib/utils';

type FormInput = z.input<typeof tenantSettingsSchema>;
type TextField = 'raisonSociale' | 'adresse' | 'telephone' | 'rc' | 'nif' | 'nis' | 'ai' | 'rib';
type AmountField = 'timbreRate' | 'timbreMin' | 'timbreMax' | 'timbreThreshold';
type ValidationKey = 'tooShort' | 'range' | 'invalidRate' | 'invalidAmount';

const SETTINGS_KEY = ['tenant-settings'] as const;
const TIMBRE_FIELDS: readonly AmountField[] = [
  'timbreRate',
  'timbreMin',
  'timbreMax',
  'timbreThreshold',
];

/** API values → form values (amounts shown the French way). Unset amounts stay null. */
function toForm(s: TenantSettingsResponse): FormInput {
  const amount = (v: string | null) => (v === null ? null : formatDA(v, { currency: false }));
  return {
    raisonSociale: s.raisonSociale,
    adresse: s.adresse ?? '',
    telephone: s.telephone ?? '',
    rc: s.rc ?? '',
    nif: s.nif ?? '',
    nis: s.nis ?? '',
    ai: s.ai ?? '',
    rib: s.rib ?? '',
    assujettiTva: s.assujettiTva,
    creditLimitMode: s.creditLimitMode,
    negativeStockMode: s.negativeStockMode,
    priceLevelCount: s.priceLevelCount,
    timbreEnabled: s.timbreEnabled,
    timbreRate: s.timbreRate,
    timbreMin: amount(s.timbreMin),
    timbreMax: amount(s.timbreMax),
    timbreThreshold: amount(s.timbreThreshold),
  };
}

/** Empty amount inputs mean "not set". */
const emptyToNull = (v: unknown) => (v === '' ? null : v);

const ERROR_KEYS: Partial<Record<keyof FormInput, ValidationKey>> = {
  raisonSociale: 'tooShort',
  priceLevelCount: 'range',
  timbreRate: 'invalidRate',
  timbreMin: 'invalidAmount',
  timbreMax: 'invalidAmount',
  timbreThreshold: 'invalidAmount',
};

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">{children}</CardContent>
    </Card>
  );
}

function FieldShell({
  id,
  label,
  hint,
  error,
  optional,
  wide,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  optional?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('space-y-2', wide && 'sm:col-span-2')}>
      <Label htmlFor={id}>
        {label}
        {optional ? <span className="font-normal text-muted-foreground">({optional})</span> : null}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function SwitchRow({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-3 sm:col-span-2">
      <div className="space-y-1">
        <Label htmlFor={id}>{label}</Label>
        {hint ? (
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function SettingsForm() {
  const errorMessage = useErrorMessage();
  const t = useTranslations('common');
  const query = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => api.request<TenantSettingsResponse>('/tenant/settings'),
  });

  if (query.isPending) {
    return (
      <div className="grid gap-6" aria-busy>
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex items-center justify-between gap-4">
          {errorMessage(query.error)}
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            {t('retry')}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  // Remount after each save so the form restarts clean from the saved values.
  return <SettingsFormFields key={query.data.updatedAt} settings={query.data} />;
}

function SettingsFormFields({ settings }: { settings: TenantSettingsResponse }) {
  const t = useTranslations();
  const errorMessage = useErrorMessage();
  const { state } = useAuth();
  const queryClient = useQueryClient();
  const canEdit =
    state.status === 'authenticated' &&
    (state.user.role === Role.OWNER || state.user.role === Role.MANAGER);

  const form = useForm<FormInput, unknown, TenantSettings>({
    resolver: zodResolver(tenantSettingsSchema),
    defaultValues: toForm(settings),
  });
  const { errors, isDirty } = form.formState;
  const timbreEnabled = useWatch({ control: form.control, name: 'timbreEnabled' });

  const mutation = useMutation({
    mutationFn: (values: TenantSettings) =>
      api.request<TenantSettingsResponse>('/tenant/settings', { method: 'PATCH', body: values }),
    onSuccess: (saved) => {
      queryClient.setQueryData(SETTINGS_KEY, saved);
      // The number of price levels may have changed.
      void queryClient.invalidateQueries({ queryKey: ['price-levels'] });
      toast.success(t('common.saved'));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const errorFor = (e: FieldErrors<FormInput>, name: keyof FormInput) =>
    e[name] ? t(`validation.${ERROR_KEYS[name] ?? 'range'}`) : undefined;

  const aria = (id: string, error?: string, hint?: boolean) => ({
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-error` : hint ? `${id}-hint` : undefined,
  });

  const text = (
    name: TextField,
    opts: { optional?: boolean; wide?: boolean; ltr?: boolean } = {},
  ) => {
    const error = errorFor(errors, name);
    return (
      <FieldShell
        id={name}
        label={t(`settings.${name}`)}
        optional={opts.optional ? t('common.optional') : undefined}
        error={error}
        wide={opts.wide}
      >
        <Input
          {...aria(name, error)}
          dir={opts.ltr ? 'ltr' : undefined}
          autoComplete="off"
          {...form.register(name)}
        />
      </FieldShell>
    );
  };

  const amount = (name: AmountField) => {
    const error = errorFor(errors, name);
    return (
      <FieldShell id={name} label={t(`settings.${name}`)} error={error}>
        <Input
          {...aria(name, error)}
          dir="ltr"
          inputMode="decimal"
          className="num text-end"
          {...form.register(name, { setValueAs: emptyToNull })}
        />
      </FieldShell>
    );
  };

  return (
    <form
      onSubmit={(e) => void form.handleSubmit((v) => mutation.mutate(v))(e)}
      noValidate
      className="grid grid-cols-[minmax(0,1fr)] gap-6"
    >
      {!canEdit ? (
        <Alert role="status">
          <AlertDescription>{t('settings.readOnly')}</AlertDescription>
        </Alert>
      ) : null}

      <fieldset
        disabled={!canEdit || mutation.isPending}
        className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6"
      >
        <Section title={t('settings.headerSection')} description={t('settings.headerHelp')}>
          {text('raisonSociale', { wide: true })}
          {text('adresse', { wide: true, optional: true })}
          {text('telephone', { optional: true, ltr: true })}
          {text('rc', { optional: true, ltr: true })}
          {text('nif', { optional: true, ltr: true })}
          {text('nis', { optional: true, ltr: true })}
          {text('ai', { optional: true, ltr: true })}
          {text('rib', { optional: true, ltr: true })}
        </Section>

        <Section title={t('settings.rulesSection')} description={t('settings.rulesHelp')}>
          <SwitchRow
            id="assujettiTva"
            label={t('settings.assujettiTva')}
            hint={t('settings.assujettiTvaHint')}
          >
            <Controller
              control={form.control}
              name="assujettiTva"
              render={({ field }) => (
                <Switch
                  id="assujettiTva"
                  aria-describedby="assujettiTva-hint"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
          </SwitchRow>
          <FieldShell id="creditLimitMode" label={t('settings.creditLimitMode')}>
            <NativeSelect id="creditLimitMode" {...form.register('creditLimitMode')}>
              <option value="WARN">{t('settings.creditLimitWarn')}</option>
              <option value="BLOCK">{t('settings.creditLimitBlock')}</option>
            </NativeSelect>
          </FieldShell>
          <FieldShell id="negativeStockMode" label={t('settings.negativeStockMode')}>
            <NativeSelect id="negativeStockMode" {...form.register('negativeStockMode')}>
              <option value="ALLOW">{t('settings.negativeStockAllow')}</option>
              <option value="WARN">{t('settings.negativeStockWarn')}</option>
              <option value="BLOCK">{t('settings.negativeStockBlock')}</option>
            </NativeSelect>
          </FieldShell>
          <FieldShell
            id="priceLevelCount"
            label={t('settings.priceLevelCount')}
            hint={t('settings.priceLevelCountHint')}
            error={errorFor(errors, 'priceLevelCount')}
          >
            <NativeSelect
              {...aria('priceLevelCount', errorFor(errors, 'priceLevelCount'), true)}
              className="num"
              {...form.register('priceLevelCount', { valueAsNumber: true })}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </NativeSelect>
          </FieldShell>
        </Section>

        <Section title={t('settings.timbreSection')} description={t('settings.timbreHelp')}>
          <SwitchRow id="timbreEnabled" label={t('settings.timbreEnabled')}>
            <Controller
              control={form.control}
              name="timbreEnabled"
              render={({ field }) => (
                <Switch
                  id="timbreEnabled"
                  checked={field.value}
                  onCheckedChange={(on) => {
                    field.onChange(on);
                    // Hidden fields must not keep a half-typed value that blocks saving.
                    if (!on) TIMBRE_FIELDS.forEach((name) => form.resetField(name));
                  }}
                />
              )}
            />
          </SwitchRow>
          {timbreEnabled ? (
            <>
              {amount('timbreRate')}
              {amount('timbreThreshold')}
              {amount('timbreMin')}
              {amount('timbreMax')}
            </>
          ) : null}
        </Section>
      </fieldset>

      {canEdit ? (
        <div className="sticky bottom-0 -mx-4 flex justify-end border-t bg-background/95 px-4 py-3 backdrop-blur lg:-mx-6 lg:px-6">
          <Button type="submit" disabled={!isDirty || mutation.isPending} className="gap-2">
            {mutation.isPending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Save aria-hidden />
            )}
            {mutation.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
