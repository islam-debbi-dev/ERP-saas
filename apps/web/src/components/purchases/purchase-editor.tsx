'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Save, ScanBarcode, Trash2, XCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  computeTotals,
  Feature,
  formatDA,
  parseDA,
  type PriceLevelDto,
  type ProductDto,
  type PurchaseDto,
  qty,
  PAYMENT_MODES,
  type PaymentMode,
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
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { api } from '@/lib/api-client';
import { useFeature } from '@/lib/auth';
import { findProductByCode, useUnitLabel } from '@/lib/catalog';
import { useOpenImportFiles } from '@/lib/import-files';
import { purchaseKeys, useSuppliers } from '@/lib/purchases';
import { stockKeys, formatQty } from '@/lib/stock';
import { useErrorMessage } from '@/lib/use-error-message';
import { Amount } from '@/components/shared/amount';
import { WarehouseSelect } from '@/components/stock/warehouse-select';
import { CashAccountPicker } from '@/components/treasury/cash-account-picker';

export interface EditorLine {
  key: string;
  product: ProductDto;
  unitId: string;
  qty: string;
  unitCost: string;
}

interface Header {
  supplierId: string;
  documentDate: string;
  supplierRef: string;
  /** Phase 15: '' = the main dépôt. */
  warehouseId: string;
  note: string;
  paidAmount: string;
  /** Phase 34: how the paid part leaves; it becomes a règlement at validation. */
  paidMode: PaymentMode;
  /** '' = the default account for the mode. */
  paidCashAccountId: string;
  /** Phase 22: bank rate for a foreign supplier (DZD per 1 unit). */
  exchangeRate: string;
  /** Phase 22: '' = not in a dossier d'importation. */
  importFileId: string;
}

const priceKey = (productId: string, unitId: string, levelId: string) =>
  `${productId}:${unitId}:${levelId}`;

export function PurchaseEditor({
  purchase,
  initialLines,
  initialHeader,
  assujettiTva,
  levels,
}: {
  purchase: PurchaseDto | null;
  initialLines: EditorLine[];
  initialHeader: Header;
  assujettiTva: boolean;
  levels: PriceLevelDto[];
}) {
  const t = useTranslations('purchases');
  const ts = useTranslations('sales');
  const errorMessage = useErrorMessage();
  const unitLabel = useUnitLabel();
  const router = useRouter();
  const queryClient = useQueryClient();
  const suppliers = useSuppliers();
  const [header, setHeader] = useState<Header>(initialHeader);
  const warehousesOn = useFeature(Feature.WAREHOUSES);
  const importOn = useFeature(Feature.IMPORT_COSTS);
  const openFiles = useOpenImportFiles(importOn);
  const supplier = suppliers.data?.items.find((s) => s.id === header.supplierId);
  // Phase 22: a foreign supplier's prices are typed in its currency, with no Algerian TVA.
  const currency = supplier?.currency ?? 'DZD';
  const foreign = currency !== 'DZD';
  const rate = parseDA(header.exchangeRate);
  const rateValid = !foreign || (rate !== null && rate.gt(0) && rate.decimalPlaces() <= 6);
  const [lines, setLines] = useState<EditorLine[]>(initialLines);
  const [code, setCode] = useState('');
  const [looking, setLooking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [keys] = useState(() => ({ create: crypto.randomUUID(), validate: crypto.randomUUID() }));
  const scanRef = useRef<HTMLInputElement>(null);
  const qtyRefs = useRef(new Map<string, HTMLInputElement>());
  const costRefs = useRef(new Map<string, HTMLInputElement>());
  /** A line added by a scan gets focus as soon as its quantity input mounts. */
  const pendingFocus = useRef<string | null>(null);
  const focusQty = (key: string) => {
    const el = qtyRefs.current.get(key);
    el?.focus();
    el?.select();
  };

  const unitOf = (l: EditorLine) => l.product.units.find((u) => u.unitId === l.unitId);
  const totals = useMemo(
    () =>
      computeTotals(
        lines.map((l) => ({
          qty: parseDA(l.qty) ?? '0',
          unitPrice: parseDA(l.unitCost) ?? '0',
          tvaRate: foreign ? '0' : l.product.tvaRate,
        })),
        // The supplier charges TVA whatever our regime; assujettiTva only changes the cost.
        true,
      ),
    [lines, foreign],
  );
  const paid = parseDA(header.paidAmount) ?? qty(0);

  async function onScan() {
    const value = code.trim();
    if (!value) return;
    setLooking(true);
    try {
      const found = await findProductByCode(value);
      setCode('');
      if (!found) {
        toast.error(t('notFound', { code: value }));
        return;
      }
      // A reference lookup returns the base unit; receiving usually happens by the purchase unit.
      const unitId = found.product.units.some(
        (u) => u.unitId === found.unitId && u.barcode === value,
      )
        ? found.unitId
        : (found.product.units.find((u) => u.isDefaultPurchase)?.unitId ?? found.unitId);
      const existing = lines.find((l) => l.product.id === found.product.id && l.unitId === unitId);
      if (existing) {
        focusQty(existing.key);
        return;
      }
      const key = crypto.randomUUID();
      pendingFocus.current = key;
      setLines((ls) => [...ls, { key, product: found.product, unitId, qty: '1', unitCost: '' }]);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLooking(false);
    }
  }

  const update = (key: string, patch: Partial<EditorLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function body() {
    return {
      supplierId: header.supplierId,
      documentDate: header.documentDate,
      supplierRef: header.supplierRef,
      note: header.note,
      ...(warehousesOn ? { warehouseId: header.warehouseId || null } : {}),
      ...(importOn ? { importFileId: header.importFileId || null } : {}),
      ...(foreign && rate ? { exchangeRate: rate.toString() } : {}),
      paidAmount: foreign ? '0' : (parseDA(header.paidAmount) ?? qty(0)).toString(),
      paidMode: header.paidMode,
      paidCashAccountId: header.paidCashAccountId || null,
      lines: lines.map((l) => ({
        productId: l.product.id,
        unitId: l.unitId,
        qty: (parseDA(l.qty) ?? qty(0)).toString(),
        unitCost: (parseDA(l.unitCost) ?? qty(0)).toString(),
      })),
    };
  }

  const invalidLine = lines.find((l) => {
    const q = parseDA(l.qty);
    const c = parseDA(l.unitCost);
    return q === null || q.lte(0) || c === null || c.isNegative();
  });
  const canSave = Boolean(header.supplierId) && !invalidLine && rateValid;

  /** Saves the draft (create or replace) and returns the saved BR. */
  async function saveDraft(): Promise<PurchaseDto> {
    const saved = purchase
      ? await api.request<PurchaseDto>(`/purchases/${purchase.id}`, {
          method: 'PUT',
          body: { ...body(), version: purchase.version },
        })
      : await api.request<PurchaseDto>('/purchases', {
          method: 'POST',
          body: body(),
          idempotencyKey: keys.create,
        });
    queryClient.setQueryData(purchaseKeys.one(saved.id), saved);
    void queryClient.invalidateQueries({ queryKey: purchaseKeys.all });
    return saved;
  }

  const save = useMutation({
    mutationFn: saveDraft,
    onSuccess: (saved) => {
      toast.success(t('saved'));
      if (!purchase) router.replace(`/achats/${saved.id}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const validate = useMutation({
    mutationFn: async () => {
      const saved = await saveDraft();
      const priceUpdates = Object.entries(prices).flatMap(([k, v]) => {
        const parsed = parseDA(v);
        const [productId = '', unitId = '', priceLevelId = ''] = k.split(':');
        return parsed !== null && !parsed.isNegative()
          ? [{ productId, unitId, priceLevelId, priceHt: parsed.toString() }]
          : [];
      });
      return api.request<PurchaseDto>(`/purchases/${saved.id}/validate`, {
        method: 'POST',
        body: { priceUpdates },
        idempotencyKey: keys.validate,
      });
    },
    onSuccess: (validated) => {
      queryClient.setQueryData(purchaseKeys.one(validated.id), validated);
      void queryClient.invalidateQueries({ queryKey: purchaseKeys.all });
      void queryClient.invalidateQueries({ queryKey: stockKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['product'] });
      setConfirmOpen(false);
      toast.success(t('validated'));
      if (!purchase) router.replace(`/achats/${validated.id}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const cancelDraft = useMutation({
    mutationFn: () =>
      api.request<PurchaseDto>(`/purchases/${purchase?.id ?? ''}/cancel`, {
        method: 'POST',
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: (cancelled) => {
      queryClient.setQueryData(purchaseKeys.one(cancelled.id), cancelled);
      void queryClient.invalidateQueries({ queryKey: purchaseKeys.all });
      toast.success(t('cancelled'));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const busy = save.isPending || validate.isPending || cancelDraft.isPending;
  // Distinct (product, unit) pairs for the optional price update grid.
  const priceRows = lines.filter(
    (l, i) => lines.findIndex((x) => x.product.id === l.product.id && x.unitId === l.unitId) === i,
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            {t('headerSection')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="supplier">{t('supplier')}</Label>
            <NativeSelect
              id="supplier"
              value={header.supplierId}
              onChange={(e) => setHeader({ ...header, supplierId: e.target.value })}
              aria-invalid={!header.supplierId ? true : undefined}
            >
              <option value="">{t('chooseSupplier')}</option>
              {(suppliers.data?.items ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor="doc-date">{t('date')}</Label>
            <Input
              id="doc-date"
              type="date"
              dir="ltr"
              value={header.documentDate}
              onChange={(e) => setHeader({ ...header, documentDate: e.target.value })}
            />
          </div>
          <WarehouseSelect
            id="br-warehouse"
            label={t('warehouse')}
            value={header.warehouseId}
            onChange={(warehouseId) => setHeader({ ...header, warehouseId })}
            defaultLabel={t('mainWarehouse')}
          />
          {foreign ? (
            <div className="space-y-2">
              <Label htmlFor="br-rate">{t('exchangeRate', { currency })}</Label>
              <Input
                id="br-rate"
                dir="ltr"
                inputMode="decimal"
                className="num"
                aria-describedby="br-rate-hint"
                aria-invalid={!rateValid ? true : undefined}
                value={header.exchangeRate}
                onChange={(e) => setHeader({ ...header, exchangeRate: e.target.value })}
              />
              <p id="br-rate-hint" className="text-xs text-muted-foreground">
                {t('exchangeRateHint', { currency })}
              </p>
            </div>
          ) : null}
          {importOn ? (
            <div className="space-y-2">
              <Label htmlFor="br-import-file">{t('importFile')}</Label>
              <NativeSelect
                id="br-import-file"
                aria-describedby="br-import-file-hint"
                value={header.importFileId}
                onChange={(e) => setHeader({ ...header, importFileId: e.target.value })}
              >
                <option value="">{t('noImportFile')}</option>
                {(openFiles.data?.items ?? []).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.number}
                    {f.reference ? ` – ${f.reference}` : ''}
                  </option>
                ))}
              </NativeSelect>
              <p id="br-import-file-hint" className="text-xs text-muted-foreground">
                {t('importFileHint')}
              </p>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="supplier-ref">{t('supplierRef')}</Label>
            <Input
              id="supplier-ref"
              dir="ltr"
              maxLength={60}
              value={header.supplierRef}
              onChange={(e) => setHeader({ ...header, supplierRef: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="br-note">{t('note')}</Label>
            <Input
              id="br-note"
              maxLength={255}
              value={header.note}
              onChange={(e) => setHeader({ ...header, note: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            {t('linesSection')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void onScan();
            }}
          >
            <Label htmlFor="br-scan">{t('scanLabel')}</Label>
            <div className="relative">
              {looking ? (
                <Loader2
                  className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
                  aria-hidden
                />
              ) : (
                <ScanBarcode
                  className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
              )}
              <Input
                id="br-scan"
                type="search"
                enterKeyHint="search"
                ref={scanRef}
                autoFocus={purchase !== null}
                autoComplete="off"
                dir="ltr"
                className="ps-9"
                placeholder={t('scanPlaceholder')}
                aria-describedby="br-scan-hint"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            <p id="br-scan-hint" className="text-xs text-muted-foreground">
              {t('scanHint')}
            </p>
          </form>

          <div className="overflow-x-auto rounded-lg border">
            <table className="stack-table w-full min-w-[46rem] text-sm">
              <caption className="sr-only">{t('linesSection')}</caption>
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="p-2 text-start font-medium">{t('colProduct')}</th>
                  <th className="p-2 text-start font-medium">{t('colUnit')}</th>
                  <th className="p-2 text-start font-medium">{t('colQty')}</th>
                  <th className="p-2 text-start font-medium">
                    {foreign ? t('colCostIn', { currency }) : t('colCost')}
                  </th>
                  <th className="p-2 text-end font-medium">{t('colTva')}</th>
                  <th className="p-2 text-end font-medium">{t('colLineHt')}</th>
                  <th className="w-10 p-2" />
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-muted-foreground">
                      {t('noLines')}
                    </td>
                  </tr>
                ) : (
                  lines.map((l, i) => (
                    <tr key={l.key} className="border-t align-middle">
                      <td data-cell="main" className="p-2">
                        <p className="font-medium">{l.product.designation}</p>
                        <p className="text-xs text-muted-foreground" dir="ltr">
                          {l.product.reference}
                        </p>
                      </td>
                      <td data-label={t('colUnit')} className="p-2">
                        <NativeSelect
                          aria-label={`${t('colUnit')} — ${l.product.designation}`}
                          className="w-36 max-md:w-full"
                          value={l.unitId}
                          onChange={(e) => update(l.key, { unitId: e.target.value })}
                        >
                          {l.product.units.map((u) => (
                            <option key={u.unitId} value={u.unitId}>
                              {unitLabel({ code: u.unitCode, name: u.unitName })}
                              {u.unitId !== l.product.baseUnitId
                                ? ` (×${formatQty(u.factorToBase)})`
                                : ''}
                            </option>
                          ))}
                        </NativeSelect>
                      </td>
                      <td data-label={t('colQty')} className="p-2">
                        <Input
                          ref={(el) => {
                            if (el) {
                              qtyRefs.current.set(l.key, el);
                              if (pendingFocus.current === l.key) {
                                pendingFocus.current = null;
                                el.focus();
                                el.select();
                              }
                            } else qtyRefs.current.delete(l.key);
                          }}
                          aria-label={`${t('colQty')} — ${l.product.designation}`}
                          dir="ltr"
                          inputMode="decimal"
                          className="num w-24 max-md:w-full"
                          aria-invalid={(parseDA(l.qty)?.gt(0) ?? false) ? undefined : true}
                          value={l.qty}
                          onChange={(e) => update(l.key, { qty: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              costRefs.current.get(l.key)?.focus();
                            }
                          }}
                        />
                      </td>
                      <td data-label={t('colCost')} className="p-2">
                        <Input
                          ref={(el) => {
                            if (el) costRefs.current.set(l.key, el);
                            else costRefs.current.delete(l.key);
                          }}
                          aria-label={`${t('colCost')} — ${l.product.designation}`}
                          dir="ltr"
                          inputMode="decimal"
                          className="num w-32 max-md:w-full"
                          aria-invalid={
                            l.unitCost !== '' && parseDA(l.unitCost) === null ? true : undefined
                          }
                          value={l.unitCost}
                          onChange={(e) => update(l.key, { unitCost: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              scanRef.current?.focus();
                            }
                          }}
                        />
                      </td>
                      <td
                        data-label={t('colTva')}
                        className="num p-2 text-end text-muted-foreground"
                      >
                        {`${foreign ? '0' : qty(l.product.tvaRate).toString()} %`}
                      </td>
                      <td
                        data-label={t('colLineHt')}
                        className="num p-2 text-end font-medium whitespace-nowrap"
                      >
                        <Amount value={totals.lines[i]?.lineHt ?? '0'} />
                      </td>
                      <td data-cell="actions" className="p-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('remove', { product: l.product.designation })}
                          onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            {t('totals')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <dl className="num space-y-1 text-sm sm:order-2">
            <div className="flex justify-between gap-4">
              <dt>{t('totalHt')}</dt>
              <dd dir="ltr">
                <Amount value={totals.totalHt} />
              </dd>
            </div>
            {totals.tvaByRate.map((r) => (
              <div
                key={r.rate.toString()}
                className="flex justify-between gap-4 text-muted-foreground"
              >
                <dt>{t('tvaAt', { rate: r.rate.toString() })}</dt>
                <dd dir="ltr">
                  <Amount value={r.tva} />
                </dd>
              </div>
            ))}
            <div className="flex justify-between gap-4 border-t pt-1 text-base font-semibold">
              <dt>{foreign ? t('totalIn', { currency }) : t('totalTtc')}</dt>
              <dd dir="ltr">
                {foreign ? (
                  <span className="whitespace-nowrap">
                    {formatDA(totals.totalTtc, { currency: false })} {currency}
                  </span>
                ) : (
                  <Amount value={totals.totalTtc} />
                )}
              </dd>
            </div>
            {foreign && rate ? (
              <div className="flex justify-between gap-4 text-muted-foreground">
                <dt>{t('totalDzd')}</dt>
                <dd dir="ltr">
                  <Amount value={totals.totalTtc.times(rate)} />
                </dd>
              </div>
            ) : null}
            <div
              className={`flex justify-between gap-4 text-muted-foreground${foreign ? ' hidden' : ''}`}
            >
              <dt>{t('rest')}</dt>
              <dd dir="ltr">
                <Amount
                  value={
                    totals.totalTtc.minus(paid).isNegative() ? '0' : totals.totalTtc.minus(paid)
                  }
                />
              </dd>
            </div>
          </dl>
          {foreign ? (
            <p className="text-xs text-muted-foreground sm:order-1">{t('foreignPaidHint')}</p>
          ) : (
            <div className="space-y-2 sm:order-1">
              <Label htmlFor="paid">{t('paid')}</Label>
              <Input
                id="paid"
                dir="ltr"
                inputMode="decimal"
                className="num sm:max-w-48"
                value={header.paidAmount}
                onChange={(e) => setHeader({ ...header, paidAmount: e.target.value })}
              />
              {parseDA(header.paidAmount)?.gt(0) ? (
                <div className="grid gap-3 sm:max-w-48">
                  <div className="space-y-2">
                    <Label htmlFor="paid-mode">{t('paidMode')}</Label>
                    <NativeSelect
                      id="paid-mode"
                      value={header.paidMode}
                      onChange={(e) =>
                        setHeader({ ...header, paidMode: e.target.value as PaymentMode })
                      }
                    >
                      {PAYMENT_MODES.map((m) => (
                        <option key={m} value={m}>
                          {ts(`mode${m}`)}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <CashAccountPicker
                    id="paid-account"
                    mode={header.paidMode}
                    warehouseId={header.warehouseId}
                    value={header.paidCashAccountId}
                    onChange={(id) => setHeader((h) => ({ ...h, paidCashAccountId: id }))}
                  />
                </div>
              ) : null}
              {!assujettiTva ? (
                <p className="text-xs text-muted-foreground">{t('tvaOff')}</p>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center justify-between gap-2 border-t bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:py-3 backdrop-blur lg:-mx-6 lg:px-6">
        <div>
          {purchase ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" disabled={busy}>
                  <XCircle aria-hidden />
                  {t('cancelBr')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('cancelTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>{t('cancelBodyDraft')}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('keep')}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => cancelDraft.mutate()}>
                    {t('cancelBr')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </div>
        {/* Wraps on phones: the two labels together are wider than 390px in French. */}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={busy || !canSave} onClick={() => save.mutate()}>
            {save.isPending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Save aria-hidden />
            )}
            {save.isPending ? t('saving') : t('saveDraft')}
          </Button>
          <Button
            disabled={busy || !canSave || lines.length === 0}
            onClick={() => setConfirmOpen(true)}
          >
            <Check aria-hidden />
            {t('validate')}
          </Button>
        </div>
      </div>

      <ResponsiveDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <ResponsiveDialogContent className="md:max-w-2xl">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t('validateTitle')}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {header.importFileId ? t('validateBodyInTransit') : t('validateBody')}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-3">
            <p className="text-sm font-medium">{t('updatePrices')}</p>
            <p className="text-xs text-muted-foreground">{t('updatePricesHint')}</p>
            <div className="overflow-x-auto rounded-lg border">
              <table className="stack-table w-full min-w-[30rem] text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="p-2 text-start font-medium">{t('colProduct')}</th>
                    {levels.map((lv) => (
                      <th key={lv.id} className="p-2 text-start font-medium">
                        {lv.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {priceRows.map((l) => {
                    const unit = unitOf(l);
                    const cost = parseDA(l.unitCost);
                    return (
                      <tr key={`${l.product.id}:${l.unitId}`} className="border-t">
                        <td className="p-2" data-cell="main">
                          <p className="font-medium">{l.product.designation}</p>
                          <p className="text-xs text-muted-foreground">
                            {unit ? unitLabel({ code: unit.unitCode, name: unit.unitName }) : ''}
                            {cost ? ` · ${t('colCost')}: ${formatDA(cost)}` : ''}
                          </p>
                        </td>
                        {levels.map((lv) => {
                          const k = priceKey(l.product.id, l.unitId, lv.id);
                          const current = l.product.prices.find(
                            (p) => p.unitId === l.unitId && p.priceLevelId === lv.id,
                          );
                          return (
                            <td key={lv.id} className="p-2" data-label={lv.name}>
                              <Input
                                aria-label={`${lv.name} — ${l.product.designation}`}
                                dir="ltr"
                                inputMode="decimal"
                                className="num w-28 max-md:w-full"
                                placeholder={
                                  current ? formatDA(current.priceHt, { currency: false }) : '—'
                                }
                                value={prices[k] ?? ''}
                                onChange={(e) => setPrices((p) => ({ ...p, [k]: e.target.value }))}
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
          </div>
          {validate.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(validate.error)}</AlertDescription>
            </Alert>
          ) : null}
          <ResponsiveDialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              {t('keep')}
            </Button>
            <Button disabled={validate.isPending} onClick={() => validate.mutate()}>
              {validate.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Check aria-hidden />
              )}
              {t('validate')}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}
