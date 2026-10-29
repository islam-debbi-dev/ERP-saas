'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import {
  COMMON_TVA_RATES,
  createProductSchema,
  formatDA,
  parseDA,
  type PriceLevelDto,
  type ProductDto,
  qty,
  suggestedPackagingPrice,
  type TenantSettingsResponse,
  type UnitDto,
  updateProductSchema,
} from '@erp/shared';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { ProductCost } from './product-cost';
import { api, ApiError } from '@/lib/api-client';
import { catalogKeys, flattenCategories, useCategories, useUnitLabel } from '@/lib/catalog';
import { useBrands } from '@/lib/sales-force';
import { useErrorMessage } from '@/lib/use-error-message';
import { cn } from '@/lib/utils';

interface UnitRow {
  unitId: string;
  factorToBase: string;
  barcode: string;
}

interface FormValues {
  reference: string;
  designation: string;
  categoryId: string;
  brandId: string;
  baseUnitId: string;
  tvaRate: string;
  minStock: string;
  active: boolean;
  units: UnitRow[];
  defaultSale: string;
  defaultPurchase: string;
  /** "unitId:priceLevelId" → price as typed. */
  prices: Record<string, string>;
}

const priceKey = (unitId: string, levelId: string) => `${unitId}:${levelId}`;
const display = (value: string) => formatDA(value, { currency: false });

function toFormValues(product: ProductDto | null, units: UnitDto[]): FormValues {
  if (!product) {
    const piece = units.find((u) => u.code === 'PIECE') ?? units[0];
    const base = piece?.id ?? '';
    return {
      reference: '',
      designation: '',
      categoryId: '',
      brandId: '',
      baseUnitId: base,
      tvaRate: '19',
      minStock: '0',
      active: true,
      units: [{ unitId: base, factorToBase: '1', barcode: '' }],
      defaultSale: base,
      defaultPurchase: base,
      prices: {},
    };
  }
  return {
    reference: product.reference,
    designation: product.designation,
    categoryId: product.categoryId ?? '',
    brandId: product.brandId ?? '',
    baseUnitId: product.baseUnitId,
    tvaRate: qty(product.tvaRate).toString(),
    minStock: qty(product.minStock).toString(),
    active: product.active,
    // Base unit first, then packagings by size.
    units: [...product.units]
      .sort((a, b) =>
        a.unitId === product.baseUnitId ? -1 : b.unitId === product.baseUnitId ? 1 : 0,
      )
      .map((u) => ({
        unitId: u.unitId,
        factorToBase: qty(u.factorToBase).toString(),
        barcode: u.barcode ?? '',
      })),
    defaultSale: product.units.find((u) => u.isDefaultSale)?.unitId ?? product.baseUnitId,
    defaultPurchase: product.units.find((u) => u.isDefaultPurchase)?.unitId ?? product.baseUnitId,
    prices: Object.fromEntries(
      product.prices.map((p) => [priceKey(p.unitId, p.priceLevelId), display(p.priceHt)]),
    ),
  };
}

function Section({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {title}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className={className}>{children}</CardContent>
    </Card>
  );
}

export function ProductForm({
  product,
  units,
  levels,
  settings,
}: {
  product: ProductDto | null;
  units: UnitDto[];
  levels: PriceLevelDto[];
  settings: TenantSettingsResponse;
}) {
  const t = useTranslations('products');
  const tc = useTranslations('common');
  const tv = useTranslations('validation');
  const errorMessage = useErrorMessage();
  const unitLabel = useUnitLabel();
  const router = useRouter();
  const queryClient = useQueryClient();
  const categories = useCategories();
  const brands = useBrands();
  const [problems, setProblems] = useState<string[]>([]);

  const unitById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const form = useForm<FormValues>({ defaultValues: toFormValues(product, units) });
  const rows = useFieldArray({ control: form.control, name: 'units' });
  const watched = useWatch({ control: form.control });
  const baseUnit = unitById.get(watched.baseUnitId ?? '');
  const baseLabel = unitLabel(baseUnit);
  const isEdit = product !== null;

  /** Build the API payload from what was typed. */
  function payload(v: FormValues) {
    const prices = levels.flatMap((level) =>
      v.units.flatMap((u) => {
        const raw = v.prices[priceKey(u.unitId, level.id)]?.trim();
        return raw ? [{ unitId: u.unitId, priceLevelId: level.id, priceHt: raw }] : [];
      }),
    );
    return {
      reference: v.reference,
      designation: v.designation,
      categoryId: v.categoryId || null,
      brandId: v.brandId || null,
      baseUnitId: v.baseUnitId,
      tvaRate: v.tvaRate,
      minStock: v.minStock || '0',
      active: v.active,
      units: v.units.map((u) => ({
        unitId: u.unitId,
        factorToBase: u.unitId === v.baseUnitId ? '1' : u.factorToBase,
        barcode: u.barcode.trim() || null,
        isDefaultSale: u.unitId === v.defaultSale,
        isDefaultPurchase: u.unitId === v.defaultPurchase,
      })),
      prices,
    };
  }

  const save = useMutation({
    mutationFn: (body: object) =>
      isEdit
        ? api.request<ProductDto>(`/products/${product.id}`, {
            method: 'PATCH',
            body: { ...body, version: product.version },
          })
        : api.request<ProductDto>('/products', { method: 'POST', body }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.setQueryData(catalogKeys.product(saved.id), saved);
      toast.success(isEdit ? t('saved') : t('created'));
      if (!isEdit) router.replace(`/produits/${saved.id}`);
    },
    onError: (err) => {
      const rule =
        err instanceof ApiError ? (err.details as { rule?: string } | undefined)?.rule : undefined;
      setProblems([rule && rule in RULE_KEYS ? t(`rules.${rule as RuleKey}`) : errorMessage(err)]);
    },
  });

  const archive = useMutation({
    mutationFn: (archived: boolean) =>
      api.request<ProductDto>(
        `/products/${product?.id ?? ''}/${archived ? 'archive' : 'restore'}`,
        { method: 'POST' },
      ),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.setQueryData(catalogKeys.product(saved.id), saved);
      toast.success(saved.archivedAt ? t('archived') : t('restored'));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const onSubmit = form.handleSubmit((values) => {
    const body = payload(values);
    const parsed = (isEdit ? updateProductSchema : createProductSchema).safeParse(
      isEdit ? { ...body, version: product.version } : body,
    );
    if (!parsed.success) {
      const keys = new Set(parsed.error.issues.map((i) => i.message));
      setProblems(
        [...keys].map((k) => (k in RULE_KEYS ? t(`rules.${k as RuleKey}`) : fieldMessage(k))),
      );
      return;
    }
    setProblems([]);
    save.mutate(body);
  });

  function fieldMessage(code: string): string {
    if (code === 'invalid_amount') return tv('invalidAmount');
    if (code === 'invalid_rate') return tv('invalidRate');
    return tv('required');
  }

  const usedUnitIds = new Set((watched.units ?? []).map((u) => u?.unitId));
  const freeUnits = units.filter((u) => !usedUnitIds.has(u.id));
  const tvaOptions = COMMON_TVA_RATES.includes(watched.tvaRate as (typeof COMMON_TVA_RATES)[number])
    ? COMMON_TVA_RATES
    : [...COMMON_TVA_RATES, watched.tvaRate ?? '0'];
  const busy = save.isPending || archive.isPending;
  /** The row's own unit plus the units not used by other rows, without duplicates. */
  const unitOptions = (current: string): UnitDto[] => {
    const own = unitById.get(current);
    return [...(own ? [own] : []), ...freeUnits.filter((u) => u.id !== current)];
  };

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      noValidate
      className="grid grid-cols-[minmax(0,1fr)] gap-6"
    >
      {product?.archivedAt ? (
        <Alert role="status">
          <AlertDescription>{t('archivedBanner')}</AlertDescription>
        </Alert>
      ) : null}
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

      <fieldset disabled={busy} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
        <Section
          title={t('generalSection')}
          description={t('generalHelp')}
          className="grid gap-4 sm:grid-cols-2"
        >
          <div className="space-y-2">
            <Label htmlFor="reference">{t('reference')}</Label>
            <Input
              id="reference"
              dir="ltr"
              autoFocus={!isEdit}
              autoComplete="off"
              {...form.register('reference', { required: true })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="designation">{t('designation')}</Label>
            <Input
              id="designation"
              autoComplete="off"
              {...form.register('designation', { required: true })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="categoryId">{t('category')}</Label>
            <NativeSelect id="categoryId" {...form.register('categoryId')}>
              <option value="">{t('noCategory')}</option>
              {flattenCategories(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor="brandId">{t('brand')}</Label>
            <NativeSelect id="brandId" {...form.register('brandId')}>
              <option value="">{t('noBrand')}</option>
              {(brands.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor="baseUnitId">{t('baseUnit')}</Label>
            <NativeSelect
              id="baseUnitId"
              disabled={isEdit}
              aria-describedby="baseUnitId-hint"
              {...form.register('baseUnitId', {
                onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
                  // The first row is always the base unit.
                  rows.update(0, {
                    ...form.getValues('units.0'),
                    unitId: e.target.value,
                    factorToBase: '1',
                  });
                  form.setValue('defaultSale', e.target.value);
                  form.setValue('defaultPurchase', e.target.value);
                },
              })}
            >
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {unitLabel(u)}
                </option>
              ))}
            </NativeSelect>
            <p id="baseUnitId-hint" className="text-xs text-muted-foreground">
              {t('baseUnitHint')}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tvaRate">{t('tvaRate')}</Label>
            <NativeSelect
              id="tvaRate"
              aria-describedby="tvaRate-hint"
              className="num"
              {...form.register('tvaRate')}
            >
              {tvaOptions.map((r) => (
                <option key={r} value={r}>
                  {r} %
                </option>
              ))}
            </NativeSelect>
            {!settings.assujettiTva ? (
              <p id="tvaRate-hint" className="text-xs text-muted-foreground">
                {t('tvaIgnored')}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="minStock">{t('minStock')}</Label>
            <Input
              id="minStock"
              dir="ltr"
              inputMode="decimal"
              className="num"
              aria-describedby="minStock-hint"
              {...form.register('minStock')}
            />
            <p id="minStock-hint" className="text-xs text-muted-foreground">
              {t('minStockHint')}
            </p>
          </div>
          <div className="flex items-start justify-between gap-4 rounded-lg border p-3 sm:col-span-2">
            <div className="space-y-1">
              <Label htmlFor="active">{t('active')}</Label>
              <p className="text-xs text-muted-foreground">{t('activeHint')}</p>
            </div>
            <Switch
              id="active"
              checked={watched.active ?? true}
              onCheckedChange={(v) => form.setValue('active', v, { shouldDirty: true })}
            />
          </div>
        </Section>

        <Section title={t('unitsSection')} description={t('unitsHelp')} className="space-y-3">
          <div className="overflow-x-auto rounded-lg border">
            <table className="stack-table w-full min-w-[40rem] text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr className="text-start">
                  <th className="p-2 text-start font-medium">{t('unit')}</th>
                  <th className="p-2 text-start font-medium">{t('factor')}</th>
                  <th className="p-2 text-start font-medium">{t('barcode')}</th>
                  <th className="p-2 text-center font-medium" title={t('defaultSaleHint')}>
                    {t('defaultSale')}
                  </th>
                  <th className="p-2 text-center font-medium" title={t('defaultPurchaseHint')}>
                    {t('defaultPurchase')}
                  </th>
                  <th className="w-10 p-2" />
                </tr>
              </thead>
              <tbody>
                {rows.fields.map((field, i) => {
                  const unitId = watched.units?.[i]?.unitId ?? field.unitId;
                  const isBase = i === 0;
                  return (
                    <tr key={field.id} className="border-t">
                      <td data-cell="main" className="p-2">
                        {isBase ? (
                          <span className="flex items-center gap-2">
                            {unitLabel(unitById.get(unitId))}
                            <Badge variant="secondary">{t('baseUnitTag')}</Badge>
                          </span>
                        ) : (
                          <NativeSelect
                            aria-label={t('unit')}
                            {...form.register(`units.${i}.unitId`)}
                          >
                            {unitOptions(unitId).map((u) => (
                              <option key={u.id} value={u.id}>
                                {unitLabel(u)}
                              </option>
                            ))}
                          </NativeSelect>
                        )}
                      </td>
                      <td data-label={t('factor')} className="p-2">
                        {isBase ? (
                          <span className="num text-muted-foreground">1</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Input
                              aria-label={t('factor')}
                              dir="ltr"
                              inputMode="decimal"
                              className="num w-24 max-md:flex-1"
                              {...form.register(`units.${i}.factorToBase`)}
                            />
                            <span className="whitespace-nowrap text-muted-foreground">
                              {t('factorSuffix', { base: baseLabel })}
                            </span>
                          </div>
                        )}
                      </td>
                      <td data-label={t('barcode')} className="p-2">
                        <Input
                          aria-label={t('barcode')}
                          dir="ltr"
                          autoComplete="off"
                          className="num"
                          {...form.register(`units.${i}.barcode`)}
                        />
                      </td>
                      <td data-label={t('defaultSale')} className="p-2 text-center">
                        <input
                          type="radio"
                          aria-label={`${t('defaultSaleHint')} — ${unitLabel(unitById.get(unitId))}`}
                          className="size-6 accent-[var(--primary)] md:size-4"
                          value={unitId}
                          {...form.register('defaultSale')}
                        />
                      </td>
                      <td data-label={t('defaultPurchase')} className="p-2 text-center">
                        <input
                          type="radio"
                          aria-label={`${t('defaultPurchaseHint')} — ${unitLabel(unitById.get(unitId))}`}
                          className="size-6 accent-[var(--primary)] md:size-4"
                          value={unitId}
                          {...form.register('defaultPurchase')}
                        />
                      </td>
                      <td data-cell="actions" className="p-2">
                        {isBase ? null : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t('removeUnit')}
                            onClick={() => {
                              if (watched.defaultSale === unitId)
                                form.setValue('defaultSale', watched.baseUnitId ?? '');
                              if (watched.defaultPurchase === unitId)
                                form.setValue('defaultPurchase', watched.baseUnitId ?? '');
                              rows.remove(i);
                            }}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={freeUnits.length === 0}
            onClick={() => {
              const next = freeUnits.find((u) => u.code === 'CARTON') ?? freeUnits[0];
              if (next) rows.append({ unitId: next.id, factorToBase: '', barcode: '' });
            }}
          >
            <Plus aria-hidden />
            {t('addUnit')}
          </Button>
        </Section>

        <Section title={t('pricesSection')} description={t('pricesHelp')}>
          <div className="overflow-x-auto rounded-lg border">
            <table className="stack-table w-full min-w-[32rem] text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="p-2 text-start font-medium">{t('unit')}</th>
                  {levels.map((l) => (
                    <th key={l.id} className="p-2 text-start font-medium">
                      {l.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(watched.units ?? []).map((u, i) => {
                  const unitId = u?.unitId;
                  if (!unitId) return null;
                  const isBase = i === 0;
                  return (
                    <tr key={unitId} className="border-t">
                      <td data-cell="main" className="p-2 whitespace-nowrap">
                        {unitLabel(unitById.get(unitId))}
                      </td>
                      {levels.map((l) => {
                        const basePrice = parseDA(
                          watched.prices?.[priceKey(watched.baseUnitId ?? '', l.id)] ?? '',
                        );
                        const factor = parseDA(u?.factorToBase ?? '');
                        const suggestion =
                          !isBase && basePrice && factor && factor.gt(0)
                            ? display(suggestedPackagingPrice(basePrice, factor).toString())
                            : undefined;
                        return (
                          <td data-label={l.name} key={l.id} className="p-2">
                            <Input
                              aria-label={`${l.name} — ${unitLabel(unitById.get(unitId))}`}
                              dir="ltr"
                              inputMode="decimal"
                              className={cn('num w-32 text-end max-md:w-full')}
                              placeholder={suggestion}
                              title={suggestion ? t('suggested', { price: suggestion }) : undefined}
                              {...form.register(`prices.${priceKey(unitId, l.id)}`)}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title={t('costSection')}>
          <ProductCost productId={product?.id ?? null} />
        </Section>
      </fieldset>

      <div className="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center justify-between gap-2 border-t bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:py-3 backdrop-blur lg:-mx-6 lg:px-6">
        <div className="flex gap-2">
          <Button asChild variant="ghost">
            <Link href="/produits">{t('cancel')}</Link>
          </Button>
          {isEdit ? (
            product.archivedAt ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => archive.mutate(false)}
              >
                <ArchiveRestore aria-hidden />
                {t('restore')}
              </Button>
            ) : (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="outline" disabled={busy}>
                    <Archive aria-hidden />
                    {t('archive')}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('archiveTitle')}</AlertDialogTitle>
                    <AlertDialogDescription>{t('archiveBody')}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                    <AlertDialogAction onClick={() => archive.mutate(true)}>
                      {t('archive')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )
          ) : null}
        </div>
        <Button type="submit" disabled={busy} className="gap-2">
          {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
          {isEdit ? tc('save') : save.isPending ? t('creating') : t('create')}
        </Button>
      </div>
    </form>
  );
}

const RULE_KEYS = {
  base_unit_missing: true,
  base_factor_not_one: true,
  duplicate_unit: true,
  duplicate_barcode: true,
  exactly_one_default_sale: true,
  exactly_one_default_purchase: true,
  invalid_quantity: true,
  invalid_barcode: true,
  whole_factor_required: true,
  whole_min_stock_required: true,
  base_unit_immutable: true,
} as const;
type RuleKey = keyof typeof RULE_KEYS;
