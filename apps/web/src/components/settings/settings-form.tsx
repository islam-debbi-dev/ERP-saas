'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
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
import { Button } from '@/components/ui/button';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { messageFor } from '@/lib/form-errors';
import { t, type MessageKey } from '@/lib/i18n';

type FormInput = z.input<typeof tenantSettingsSchema>;
type TextField = 'raisonSociale' | 'adresse' | 'telephone' | 'rc' | 'nif' | 'nis' | 'ai' | 'rib';
type AmountField = 'timbreRate' | 'timbreMin' | 'timbreMax' | 'timbreThreshold';

const SETTINGS_KEY = ['tenant-settings'] as const;

/** API values → form values (amounts shown the French way, nulls as empty inputs). */
function toForm(s: TenantSettingsResponse): FormInput {
  const amount = (v: string | null) => (v === null ? '' : formatDA(v, { currency: false }));
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
    timbreRate: s.timbreRate ?? '',
    timbreMin: amount(s.timbreMin),
    timbreMax: amount(s.timbreMax),
    timbreThreshold: amount(s.timbreThreshold),
  };
}

/** Empty amount inputs mean "not set". */
const emptyToNull = (v: unknown) => (v === '' ? null : v);

const ERROR_KEYS: Partial<Record<keyof FormInput, MessageKey>> = {
  raisonSociale: 'validation.tooShort',
  priceLevelCount: 'validation.range',
  timbreRate: 'validation.invalidRate',
  timbreMin: 'validation.invalidAmount',
  timbreMax: 'validation.invalidAmount',
  timbreThreshold: 'validation.invalidAmount',
};

function errorFor(errors: FieldErrors<FormInput>, name: keyof FormInput): string | undefined {
  return errors[name] ? t(ERROR_KEYS[name] ?? 'validation.range') : undefined;
}

function Section({
  title,
  help,
  children,
}: {
  title: string;
  help: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-6 border-t py-8 first:border-t-0 first:pt-0 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{help}</p>
      </div>
      <div className="grid max-w-2xl gap-5 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function SettingsForm() {
  const { state } = useAuth();
  const queryClient = useQueryClient();
  const canEdit =
    state.status === 'authenticated' &&
    (state.user.role === Role.OWNER || state.user.role === Role.MANAGER);

  const query = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => api.request<TenantSettingsResponse>('/tenant/settings'),
  });

  const form = useForm<FormInput, unknown, TenantSettings>({
    resolver: zodResolver(tenantSettingsSchema),
  });
  const { errors, isDirty } = form.formState;
  const timbreEnabled = useWatch({ control: form.control, name: 'timbreEnabled' });

  useEffect(() => {
    if (query.data) form.reset(toForm(query.data));
  }, [query.data, form]);

  const mutation = useMutation({
    mutationFn: (values: TenantSettings) =>
      api.request<TenantSettingsResponse>('/tenant/settings', { method: 'PATCH', body: values }),
    onSuccess: (saved) => {
      queryClient.setQueryData(SETTINGS_KEY, saved);
      toast.success(t('common.saved'));
    },
    onError: (err) => toast.error(messageFor(err)),
  });

  if (query.isPending) {
    return (
      <p role="status" className="text-muted-foreground">
        {t('common.loading')}
      </p>
    );
  }
  if (query.isError) {
    return (
      <div role="alert" className="flex items-center gap-4">
        <p className="text-destructive">{messageFor(query.error)}</p>
        <Button variant="outline" onClick={() => void query.refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }

  const text = (
    name: TextField,
    opts: { optional?: boolean; wide?: boolean; autoComplete?: string } = {},
  ) => (
    <Field
      id={name}
      label={t(`settings.${name}`)}
      optional={opts.optional}
      optionalLabel={t('common.optional')}
      error={errorFor(errors, name)}
      className={opts.wide ? 'sm:col-span-2' : undefined}
    >
      <Input
        {...fieldAria(name, errorFor(errors, name))}
        autoComplete={opts.autoComplete ?? 'off'}
        {...form.register(name)}
      />
    </Field>
  );

  const amount = (name: AmountField) => (
    <Field id={name} label={t(`settings.${name}`)} error={errorFor(errors, name)}>
      <Input
        {...fieldAria(name, errorFor(errors, name))}
        inputMode="decimal"
        className="num text-right"
        {...form.register(name, { setValueAs: emptyToNull })}
      />
    </Field>
  );

  return (
    <form onSubmit={(e) => void form.handleSubmit((v) => mutation.mutate(v))(e)} noValidate>
      {!canEdit ? (
        <p className="mb-6 max-w-3xl rounded-md border bg-card px-4 py-3 text-sm text-muted-foreground">
          {t('settings.readOnly')}
        </p>
      ) : null}

      <fieldset disabled={!canEdit || mutation.isPending} className="min-w-0">
        <Section title={t('settings.headerSection')} help={t('settings.headerHelp')}>
          {text('raisonSociale', { wide: true, autoComplete: 'organization' })}
          {text('adresse', { wide: true, optional: true, autoComplete: 'street-address' })}
          {text('telephone', { optional: true, autoComplete: 'tel' })}
          {text('rc', { optional: true })}
          {text('nif', { optional: true })}
          {text('nis', { optional: true })}
          {text('ai', { optional: true })}
          {text('rib', { optional: true })}
        </Section>

        <Section title={t('settings.rulesSection')} help={t('settings.rulesHelp')}>
          <div className="flex items-start justify-between gap-4 sm:col-span-2">
            <div>
              <label htmlFor="assujettiTva" className="text-sm font-medium">
                {t('settings.assujettiTva')}
              </label>
              <p id="assujettiTva-hint" className="text-sm text-muted-foreground">
                {t('settings.assujettiTvaHint')}
              </p>
            </div>
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
          </div>
          <Field id="creditLimitMode" label={t('settings.creditLimitMode')}>
            <NativeSelect id="creditLimitMode" {...form.register('creditLimitMode')}>
              <option value="WARN">{t('settings.creditLimitWarn')}</option>
              <option value="BLOCK">{t('settings.creditLimitBlock')}</option>
            </NativeSelect>
          </Field>
          <Field id="negativeStockMode" label={t('settings.negativeStockMode')}>
            <NativeSelect id="negativeStockMode" {...form.register('negativeStockMode')}>
              <option value="ALLOW">{t('settings.negativeStockAllow')}</option>
              <option value="WARN">{t('settings.negativeStockWarn')}</option>
              <option value="BLOCK">{t('settings.negativeStockBlock')}</option>
            </NativeSelect>
          </Field>
          <Field
            id="priceLevelCount"
            label={t('settings.priceLevelCount')}
            hint={t('settings.priceLevelCountHint')}
            error={errorFor(errors, 'priceLevelCount')}
          >
            <NativeSelect
              {...fieldAria('priceLevelCount', errorFor(errors, 'priceLevelCount'), 'hint')}
              className="num"
              {...form.register('priceLevelCount', { valueAsNumber: true })}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </Section>

        <Section title={t('settings.timbreSection')} help={t('settings.timbreHelp')}>
          <div className="flex items-center justify-between gap-4 sm:col-span-2">
            <label htmlFor="timbreEnabled" className="text-sm font-medium">
              {t('settings.timbreEnabled')}
            </label>
            <Controller
              control={form.control}
              name="timbreEnabled"
              render={({ field }) => (
                <Switch id="timbreEnabled" checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
          </div>
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
        <div className="sticky bottom-0 -mx-4 mt-2 flex justify-end border-t bg-background/95 px-4 py-4 backdrop-blur sm:-mx-8 sm:px-8">
          <Button type="submit" disabled={!isDirty || mutation.isPending}>
            {mutation.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
