'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import {
  type ClientDto,
  ClientType,
  Feature,
  createClientSchema,
  formatDA,
  type PriceLevelDto,
  updateClientSchema,
} from '@erp/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { StickyActions } from '@/components/shared/sticky-actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { api } from '@/lib/api-client';
import { useFeature } from '@/lib/auth';
import { clientKeys, useCanManageCredit } from '@/lib/clients';
import { useIsOffice, useSectors, useSellers } from '@/lib/sales-force';
import { useClientSegments } from '@/lib/distribution-stats';
import { useErrorMessage } from '@/lib/use-error-message';

const TEXT_FIELDS = [
  'code',
  'name',
  'phone',
  'phone2',
  'address',
  'wilaya',
  'commune',
  'rc',
  'nif',
  'nis',
  'ai',
  'notes',
] as const;
type TextField = (typeof TEXT_FIELDS)[number];

type FormValues = Record<TextField, string> & {
  type: ClientType;
  priceLevelId: string;
  creditLimit: string;
  sectorId: string;
  assignedSellerId: string;
  segmentId: string;
};

function toFormValues(c: ClientDto | null): FormValues {
  const text = Object.fromEntries(TEXT_FIELDS.map((k) => [k, c?.[k] ?? ''])) as Record<
    TextField,
    string
  >;
  return {
    ...text,
    type: c?.type ?? ClientType.PARTICULIER,
    priceLevelId: c?.priceLevelId ?? '',
    creditLimit: c?.creditLimit ? formatDA(c.creditLimit, { currency: false }) : '',
    sectorId: c?.sector?.id ?? '',
    assignedSellerId: c?.assignedSeller?.id ?? '',
    segmentId: c?.segment?.id ?? '',
  };
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {title}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">{children}</CardContent>
    </Card>
  );
}

export function ClientForm({
  client,
  levels,
}: {
  client: ClientDto | null;
  levels: PriceLevelDto[];
}) {
  const t = useTranslations('clients');
  const tc = useTranslations('common');
  const tv = useTranslations('validation');
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const queryClient = useQueryClient();
  const canManageCredit = useCanManageCredit();
  // Sales force (phase 14): office roles set the sector and the seller; a seller's new
  // client is assigned to him by the API.
  const salesForce = useFeature(Feature.SALES_FORCE);
  const canAssign = useIsOffice() && salesForce;
  const sectors = useSectors();
  const sellers = useSellers();
  // Phase 37: the client's type (segment) for the statistics.
  const segmentsOn = useFeature(Feature.DISTRIBUTION_STATS);
  const segments = useClientSegments(segmentsOn);
  const [problems, setProblems] = useState<string[]>([]);
  const form = useForm<FormValues>({ defaultValues: toFormValues(client) });
  const type = useWatch({ control: form.control, name: 'type' });
  const isEdit = client !== null;

  const save = useMutation({
    mutationFn: (body: object) =>
      isEdit
        ? api.request<ClientDto>(`/clients/${client.id}`, { method: 'PATCH', body })
        : api.request<ClientDto>('/clients', { method: 'POST', body }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: clientKeys.all });
      queryClient.setQueryData(clientKeys.one(saved.id), saved);
      toast.success(isEdit ? t('saved') : t('created'));
      router.push(`/clients/${saved.id}`);
    },
    onError: (err) => setProblems([errorMessage(err)]),
  });

  const onSubmit = form.handleSubmit(({ sectorId, assignedSellerId, segmentId, ...v }) => {
    const body = {
      ...v,
      ...(segmentsOn ? { segmentId: segmentId || null } : {}),
      ...(canAssign
        ? { sectorId: sectorId || null, assignedSellerId: assignedSellerId || null }
        : {}),
      priceLevelId: v.priceLevelId || null,
      creditLimit: v.creditLimit.trim() || null,
      active: client?.active ?? true,
      ...(isEdit ? { version: client.version } : {}),
    };
    const parsed = (isEdit ? updateClientSchema : createClientSchema).safeParse(body);
    if (!parsed.success) {
      const fields = new Set(parsed.error.issues.map((i) => String(i.path[0])));
      setProblems(
        [...fields].map((f) =>
          f === 'creditLimit' ? tv('invalidAmount') : `${t(f as TextField)} : ${tv('required')}`,
        ),
      );
      return;
    }
    setProblems([]);
    save.mutate(body);
  });

  const field = (
    k: TextField,
    opts: { ltr?: boolean; wide?: boolean; required?: boolean } = {},
  ) => (
    <div className={opts.wide ? 'space-y-2 sm:col-span-2' : 'space-y-2'}>
      <Label htmlFor={k}>
        {t(k)}
        {opts.required ? null : (
          <span className="font-normal text-muted-foreground"> ({tc('optional')})</span>
        )}
      </Label>
      <Input
        id={k}
        type={k === 'phone' || k === 'phone2' ? 'tel' : undefined}
        inputMode={k === 'phone' || k === 'phone2' ? 'tel' : undefined}
        dir={opts.ltr ? 'ltr' : undefined}
        autoComplete="off"
        autoFocus={k === 'code' && !isEdit}
        required={opts.required}
        {...form.register(k)}
      />
    </div>
  );

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      noValidate
      className="grid grid-cols-[minmax(0,1fr)] gap-6"
    >
      {problems.length > 0 ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            <ul className="list-disc space-y-1 ps-4">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      <fieldset disabled={save.isPending} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
        <Section title={t('identitySection')}>
          <div className="space-y-2">
            <Label htmlFor="type">{t('type')}</Label>
            <NativeSelect id="type" {...form.register('type')}>
              <option value={ClientType.PARTICULIER}>{t('typePARTICULIER')}</option>
              <option value={ClientType.PROFESSIONNEL}>{t('typePROFESSIONNEL')}</option>
            </NativeSelect>
          </div>
          {field('code', { ltr: true, required: true })}
          {field('name', { wide: true, required: true })}
          {field('phone', { ltr: true })}
          {field('phone2', { ltr: true })}
          {field('address', { wide: true })}
          {field('wilaya')}
          {field('commune')}
        </Section>

        {type === ClientType.PROFESSIONNEL ? (
          <Section title={t('legalSection')} description={t('legalHelp')}>
            {field('rc', { ltr: true })}
            {field('nif', { ltr: true })}
            {field('nis', { ltr: true })}
            {field('ai', { ltr: true })}
          </Section>
        ) : null}

        <Section title={t('creditSection')} description={t('creditHelp')}>
          <div className="space-y-2">
            <Label htmlFor="creditLimit">
              {t('creditLimit')}
              <span className="font-normal text-muted-foreground"> ({tc('optional')})</span>
            </Label>
            <Input
              id="creditLimit"
              dir="ltr"
              inputMode="decimal"
              className="num"
              placeholder={t('noLimit')}
              readOnly={!canManageCredit}
              aria-describedby="creditLimit-hint"
              {...form.register('creditLimit')}
            />
            <p id="creditLimit-hint" className="text-xs text-muted-foreground">
              {canManageCredit ? t('creditLimitHint') : t('creditLimitManagersOnly')}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="priceLevelId">{t('priceLevel')}</Label>
            <NativeSelect id="priceLevelId" {...form.register('priceLevelId')}>
              <option value="">{t('defaultPriceLevel')}</option>
              {levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          {segmentsOn ? (
            <div className="space-y-2">
              <Label htmlFor="segmentId">{t('segment')}</Label>
              <NativeSelect id="segmentId" {...form.register('segmentId')}>
                <option value="">{t('noSegment')}</option>
                {(segments.data ?? [])
                  .filter((s) => !s.archived || s.id === client?.segment?.id)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </NativeSelect>
            </div>
          ) : null}
          {field('notes', { wide: true })}
        </Section>

        {canAssign ? (
          <Section title={t('salesForceSection')} description={t('salesForceHelp')}>
            <div className="space-y-2">
              <Label htmlFor="sectorId">{t('sector')}</Label>
              <NativeSelect id="sectorId" {...form.register('sectorId')}>
                <option value="">{t('noSector')}</option>
                {(sectors.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="assignedSellerId">{t('assignedSeller')}</Label>
              <NativeSelect id="assignedSellerId" {...form.register('assignedSellerId')}>
                <option value="">{t('noSeller')}</option>
                {(sellers.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </Section>
        ) : null}
      </fieldset>
      <StickyActions>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
          {save.isPending ? tc('saving') : tc('save')}
        </Button>
      </StickyActions>
    </form>
  );
}
