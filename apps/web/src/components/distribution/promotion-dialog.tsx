'use client';

import { Loader2, Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  type ClientDto,
  Feature,
  type ProductDto,
  PROMOTION_CLIENT_SCOPES,
  PROMOTION_TARGETS,
  type PromotionClientScope,
  type PromotionDto,
  type PromotionInputRaw,
  type PromotionTarget,
  type PromotionType,
} from '@erp/shared';
import { ClientPicker } from '@/components/sales/client-picker';
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
import { useFeature } from '@/lib/auth';
import {
  flattenCategories,
  useCategories,
  usePriceLevels,
  useProduct,
  useUnitLabel,
} from '@/lib/catalog';
import { useSavePromotion } from '@/lib/distribution';
import { todayInAlgiers } from '@/lib/purchases';
import { useBrands, useSectors } from '@/lib/sales-force';
import { useErrorMessage } from '@/lib/use-error-message';
import { ProductSelect } from './product-select';

interface Form {
  name: string;
  type: PromotionType;
  validFrom: string;
  validTo: string;
  active: boolean;
  priority: string;
  clientScope: PromotionClientScope;
  priceLevelId: string;
  sectorId: string;
  clients: { id: string; code: string; name: string }[];
  /** undefined = not changed yet (an edited promotion's product loads on its own). */
  buyProduct: ProductDto | null | undefined;
  buyUnitId: string;
  buyQty: string;
  /** null = the product bought; undefined = not changed yet. */
  freeProduct: ProductDto | null | undefined;
  freeUnitId: string;
  freeQty: string;
  repeatable: boolean;
  target: PromotionTarget;
  products: { id: string; reference: string; designation: string }[];
  brandId: string;
  categoryId: string;
  discountPct: string;
  minQtyBase: string;
}

function emptyForm(): Form {
  const today = todayInAlgiers();
  return {
    name: '',
    type: 'FREE_UNITS',
    validFrom: today,
    validTo: today,
    active: true,
    priority: '0',
    clientScope: 'ALL',
    priceLevelId: '',
    sectorId: '',
    clients: [],
    buyProduct: null,
    buyUnitId: '',
    buyQty: '10',
    freeProduct: null,
    freeUnitId: '',
    freeQty: '1',
    repeatable: true,
    target: 'PRODUCTS',
    products: [],
    brandId: '',
    categoryId: '',
    discountPct: '',
    minQtyBase: '',
  };
}

function formOf(p: PromotionDto): Form {
  return {
    ...emptyForm(),
    name: p.name,
    type: p.type,
    validFrom: p.validFrom,
    validTo: p.validTo,
    active: p.active,
    priority: String(p.priority),
    clientScope: p.clientScope,
    priceLevelId: p.priceLevelId ?? '',
    sectorId: p.sectorId ?? '',
    clients: p.clients,
    buyProduct: undefined,
    freeProduct: undefined,
    buyUnitId: p.buyUnitId ?? '',
    buyQty: p.buyQty ? String(Number(p.buyQty)) : '10',
    freeUnitId: p.freeUnitId ?? '',
    freeQty: p.freeQty ? String(Number(p.freeQty)) : '1',
    repeatable: p.repeatable,
    target: p.target ?? 'PRODUCTS',
    products: p.products,
    brandId: p.brandId ?? '',
    categoryId: p.categoryId ?? '',
    discountPct: p.discountPct ? String(Number(p.discountPct)) : '',
    minQtyBase: p.minQtyBase ? String(Number(p.minQtyBase)) : '',
  };
}

/** Create or edit a promotion (managers). The API checks every rule again. */
export function PromotionDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: PromotionDto | null;
}) {
  const t = useTranslations('promotions');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const unitLabel = useUnitLabel();
  const salesForce = useFeature(Feature.SALES_FORCE);
  const levels = usePriceLevels();
  const sectors = useSectors();
  const brands = useBrands();
  const categories = useCategories();
  const save = useSavePromotion();
  // The dialog is mounted again for each opening (key), so the form starts from `editing`.
  const [form, setForm] = useState<Form>(() => (editing ? formOf(editing) : emptyForm()));
  const [pickClient, setPickClient] = useState(false);
  const [pickedProduct, setPickedProduct] = useState<ProductDto | null>(null);
  // Editing needs the products with their units.
  const buyLoaded = useProduct(editing?.buyProduct ? editing.buyProduct.id : '');
  const freeId =
    editing?.freeProduct && editing.freeProduct.id !== editing.buyProduct?.id
      ? editing.freeProduct.id
      : '';
  const freeLoaded = useProduct(freeId);
  const buyProduct = form.buyProduct === undefined ? (buyLoaded.data ?? null) : form.buyProduct;
  const chosenFree = form.freeProduct === undefined ? (freeLoaded.data ?? null) : form.freeProduct;

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const freeProduct = chosenFree ?? buyProduct;
  const unitsOf = (p: ProductDto | null) =>
    (p?.units ?? []).map((u) => ({
      id: u.unitId,
      label: unitLabel({ code: u.unitCode, name: u.unitName }),
    }));

  const body = (): PromotionInputRaw => {
    const base = {
      name: form.name.trim(),
      validFrom: form.validFrom,
      validTo: form.validTo,
      active: form.active,
      priority: Number(form.priority || '0'),
      clientScope: form.clientScope,
      priceLevelId: form.priceLevelId || null,
      sectorId: form.sectorId || null,
      clientIds: form.clients.map((c) => c.id),
    };
    if (form.type === 'FREE_UNITS') {
      return {
        ...base,
        type: 'FREE_UNITS',
        buyProductId: buyProduct?.id ?? '',
        buyUnitId: form.buyUnitId,
        buyQty: form.buyQty,
        freeProductId: chosenFree?.id ?? null,
        freeUnitId: form.freeUnitId,
        freeQty: form.freeQty,
        repeatable: form.repeatable,
      };
    }
    return {
      ...base,
      type: 'PERCENT_DISCOUNT',
      target: form.target,
      productIds: form.products.map((p) => p.id),
      brandId: form.brandId || null,
      categoryId: form.categoryId || null,
      discountPct: form.discountPct,
      minQtyBase: form.minQtyBase || null,
    };
  };

  const submit = () =>
    save.mutate(
      { id: editing?.id ?? null, version: editing?.version ?? 1, body: body() },
      {
        onSuccess: () => {
          toast.success(editing ? t('saved') : t('created'));
          onOpenChange(false);
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );

  return (
    <>
      <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
        <ResponsiveDialogContent className="md:max-w-2xl">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>{editing ? t('edit') : t('new')}</ResponsiveDialogTitle>
            </ResponsiveDialogHeader>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="promo-name">{t('name')}</Label>
                <Input
                  id="promo-name"
                  required
                  minLength={2}
                  maxLength={80}
                  value={form.name}
                  onChange={(e) => set({ name: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="promo-type">{t('type')}</Label>
                <NativeSelect
                  id="promo-type"
                  value={form.type}
                  disabled={!!editing}
                  onChange={(e) => set({ type: e.target.value as PromotionType })}
                >
                  <option value="FREE_UNITS">{t('typeFREE_UNITS')}</option>
                  <option value="PERCENT_DISCOUNT">{t('typePERCENT_DISCOUNT')}</option>
                </NativeSelect>
              </div>
              <div className="space-y-1">
                <Label htmlFor="promo-priority">{t('priority')}</Label>
                <Input
                  id="promo-priority"
                  dir="ltr"
                  inputMode="numeric"
                  className="num"
                  value={form.priority}
                  onChange={(e) => set({ priority: e.target.value.replace(/[^\d]/g, '') })}
                />
                <p className="text-xs text-muted-foreground">{t('priorityHelp')}</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="promo-from">{t('validFrom')}</Label>
                <Input
                  id="promo-from"
                  type="date"
                  required
                  value={form.validFrom}
                  onChange={(e) => set({ validFrom: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="promo-to">{t('validTo')}</Label>
                <Input
                  id="promo-to"
                  type="date"
                  required
                  min={form.validFrom}
                  value={form.validTo}
                  onChange={(e) => set({ validTo: e.target.value })}
                />
              </div>
            </div>

            {form.type === 'FREE_UNITS' ? (
              <fieldset className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
                <legend className="px-1 text-sm font-medium">{t('freeRule')}</legend>
                <div className="sm:col-span-2">
                  <ProductSelect
                    id="promo-buy-product"
                    label={t('buyProduct')}
                    value={buyProduct}
                    onChange={(p) => set({ buyProduct: p, buyUnitId: p?.units[0]?.unitId ?? '' })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="promo-buy-qty">{t('buyQty')}</Label>
                  <Input
                    id="promo-buy-qty"
                    dir="ltr"
                    inputMode="decimal"
                    className="num"
                    required
                    value={form.buyQty}
                    onChange={(e) => set({ buyQty: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="promo-buy-unit">{t('unit')}</Label>
                  <NativeSelect
                    id="promo-buy-unit"
                    required
                    value={form.buyUnitId}
                    onChange={(e) => set({ buyUnitId: e.target.value })}
                  >
                    <option value="">{t('pickUnit')}</option>
                    {unitsOf(buyProduct).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.label}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="sm:col-span-2">
                  <ProductSelect
                    id="promo-free-product"
                    label={t('freeProduct')}
                    emptyLabel={t('sameProduct')}
                    value={chosenFree}
                    onChange={(p) => set({ freeProduct: p, freeUnitId: '' })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="promo-free-qty">{t('freeQty')}</Label>
                  <Input
                    id="promo-free-qty"
                    dir="ltr"
                    inputMode="decimal"
                    className="num"
                    required
                    value={form.freeQty}
                    onChange={(e) => set({ freeQty: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="promo-free-unit">{t('unit')}</Label>
                  <NativeSelect
                    id="promo-free-unit"
                    required
                    value={form.freeUnitId}
                    onChange={(e) => set({ freeUnitId: e.target.value })}
                  >
                    <option value="">{t('pickUnit')}</option>
                    {unitsOf(freeProduct).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.label}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="flex min-h-11 items-center gap-2 sm:col-span-2">
                  <Switch
                    id="promo-repeatable"
                    checked={form.repeatable}
                    onCheckedChange={(v) => set({ repeatable: v })}
                  />
                  <Label htmlFor="promo-repeatable">{t('repeatable')}</Label>
                </div>
              </fieldset>
            ) : (
              <fieldset className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
                <legend className="px-1 text-sm font-medium">{t('discountRule')}</legend>
                <div className="space-y-1">
                  <Label htmlFor="promo-target">{t('target')}</Label>
                  <NativeSelect
                    id="promo-target"
                    value={form.target}
                    onChange={(e) => set({ target: e.target.value as PromotionTarget })}
                  >
                    {PROMOTION_TARGETS.map((x) => (
                      <option key={x} value={x}>
                        {t(`target${x}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="promo-pct">{t('discountPct')}</Label>
                  <Input
                    id="promo-pct"
                    dir="ltr"
                    inputMode="decimal"
                    className="num"
                    required
                    value={form.discountPct}
                    onChange={(e) => set({ discountPct: e.target.value })}
                  />
                </div>
                {form.target === 'PRODUCTS' ? (
                  <div className="space-y-2 sm:col-span-2">
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <ProductSelect
                          id="promo-products"
                          label={t('products')}
                          value={pickedProduct}
                          onChange={setPickedProduct}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-11"
                        disabled={!pickedProduct}
                        onClick={() => {
                          if (!pickedProduct) return;
                          if (!form.products.some((p) => p.id === pickedProduct.id)) {
                            set({ products: [...form.products, pickedProduct] });
                          }
                          setPickedProduct(null);
                        }}
                      >
                        <Plus aria-hidden />
                        {t('add')}
                      </Button>
                    </div>
                    <Chips
                      items={form.products.map((p) => ({ id: p.id, label: p.designation }))}
                      removeLabel={(label) => t('removeNamed', { name: label })}
                      onRemove={(id) => set({ products: form.products.filter((p) => p.id !== id) })}
                    />
                  </div>
                ) : form.target === 'BRAND' ? (
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="promo-brand">{t('brand')}</Label>
                    <NativeSelect
                      id="promo-brand"
                      required
                      value={form.brandId}
                      onChange={(e) => set({ brandId: e.target.value })}
                    >
                      <option value="">{t('pickBrand')}</option>
                      {(brands.data ?? []).map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                ) : (
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="promo-category">{t('category')}</Label>
                    <NativeSelect
                      id="promo-category"
                      required
                      value={form.categoryId}
                      onChange={(e) => set({ categoryId: e.target.value })}
                    >
                      <option value="">{t('pickCategory')}</option>
                      {flattenCategories(categories.data ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </NativeSelect>
                    <p className="text-xs text-muted-foreground">{t('categoryHelp')}</p>
                  </div>
                )}
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="promo-min">{t('minQtyBase')}</Label>
                  <Input
                    id="promo-min"
                    dir="ltr"
                    inputMode="decimal"
                    className="num"
                    placeholder={t('minQtyNone')}
                    value={form.minQtyBase}
                    onChange={(e) => set({ minQtyBase: e.target.value })}
                  />
                </div>
              </fieldset>
            )}

            <fieldset className="grid gap-3 rounded-lg border p-3">
              <legend className="px-1 text-sm font-medium">{t('clients')}</legend>
              <NativeSelect
                id="promo-scope"
                aria-label={t('clientScope')}
                value={form.clientScope}
                onChange={(e) => set({ clientScope: e.target.value as PromotionClientScope })}
              >
                {PROMOTION_CLIENT_SCOPES.filter((s) => s !== 'SECTOR' || salesForce).map((s) => (
                  <option key={s} value={s}>
                    {t(`scope${s}`)}
                  </option>
                ))}
              </NativeSelect>
              {form.clientScope === 'PRICE_LEVEL' ? (
                <NativeSelect
                  aria-label={t('priceLevel')}
                  required
                  value={form.priceLevelId}
                  onChange={(e) => set({ priceLevelId: e.target.value })}
                >
                  <option value="">{t('pickPriceLevel')}</option>
                  {(levels.data ?? []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </NativeSelect>
              ) : null}
              {form.clientScope === 'SECTOR' ? (
                <NativeSelect
                  aria-label={t('sector')}
                  required
                  value={form.sectorId}
                  onChange={(e) => set({ sectorId: e.target.value })}
                >
                  <option value="">{t('pickSector')}</option>
                  {(sectors.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              ) : null}
              {form.clientScope === 'CLIENTS' ? (
                <div className="space-y-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    onClick={() => setPickClient(true)}
                  >
                    <Plus aria-hidden />
                    {t('addClient')}
                  </Button>
                  <Chips
                    items={form.clients.map((c) => ({ id: c.id, label: c.name }))}
                    removeLabel={(label) => t('removeNamed', { name: label })}
                    onRemove={(id) => set({ clients: form.clients.filter((c) => c.id !== id) })}
                  />
                </div>
              ) : null}
            </fieldset>

            <div className="flex min-h-11 items-center gap-2">
              <Switch
                id="promo-active"
                checked={form.active}
                onCheckedChange={(v) => set({ active: v })}
              />
              <Label htmlFor="promo-active">{t('active')}</Label>
            </div>

            <ResponsiveDialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {tc('cancel')}
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {tc('save')}
              </Button>
            </ResponsiveDialogFooter>
          </form>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
      <ClientPicker
        open={pickClient}
        onOpenChange={setPickClient}
        withCounter={false}
        onPick={(c: ClientDto | null) => {
          setPickClient(false);
          if (c && !form.clients.some((x) => x.id === c.id)) {
            set({ clients: [...form.clients, { id: c.id, code: c.code, name: c.name }] });
          }
        }}
      />
    </>
  );
}

function Chips({
  items,
  onRemove,
  removeLabel,
}: {
  items: { id: string; label: string }[];
  onRemove: (id: string) => void;
  removeLabel: (label: string) => string;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((i) => (
        <li
          key={i.id}
          className="flex max-w-full items-center gap-1 rounded-full border ps-3 text-sm"
        >
          <span className="truncate" title={i.label}>
            {i.label}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 rounded-full"
            aria-label={removeLabel(i.label)}
            onClick={() => onRemove(i.id)}
          >
            <X aria-hidden />
          </Button>
        </li>
      ))}
    </ul>
  );
}
