'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Minus, Plus, Save, ScanBarcode, Trash2, UserRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Fragment, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  type ClientDto,
  computeTotals,
  computeTimbre,
  Feature,
  formatDA,
  money,
  parseDA,
  type PaymentMode,
  PAYMENT_MODES,
  type PriceLevelDto,
  type ProductDto,
  type ProductPage,
  type SaleDto,
  type SaleResultDto,
  SaleType,
  type TenantSettingsResponse,
  type GeoInput,
} from '@erp/shared';
import { BalanceAmount, PlafondBar } from '@/components/clients/balance-amount';
import { PageHeader } from '@/components/shared/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api-client';
import { useFeature } from '@/lib/auth';
import { findProductByCode, useUnitLabel } from '@/lib/catalog';
import { clientKeys, useCanManageCredit, useClient } from '@/lib/clients';
import { useIsOffice, useSellers } from '@/lib/sales-force';
import { todayInAlgiers } from '@/lib/purchases';
import { effectiveLevel, listPrice, saleKeys } from '@/lib/sales';
import { formatQty, stockKeys } from '@/lib/stock';
import { useErrorMessage } from '@/lib/use-error-message';
import { useWarehouseFilter } from '@/lib/warehouse-scope';
import { cn, isolateLtr } from '@/lib/utils';
import { usePrint } from '@/components/shared/print-button';
import {
  PackagingReturnedCard,
  packagingReturnedInput,
  PromoNote,
  useSalePromotions,
} from '@/components/distribution/sale-promotions';
import { ClientPicker } from './client-picker';
import { Kbd } from './kbd';
import { Amount } from '@/components/shared/amount';
import { StickyActions } from '@/components/shared/sticky-actions';
import { WarehouseSelect } from '@/components/stock/warehouse-select';
import { GeoPrivacyNotice, isGeoCancelled, useGeoSubmit } from '@/components/geo/use-geo-submit';
import { useIsMobile } from '@/hooks/use-mobile';

export interface ScreenLine {
  key: string;
  product: ProductDto;
  unitId: string;
  qty: string;
  /** Typed price (managers); null = the list price of the client's level. */
  price: string | null;
  discount: string;
  /** Free units (UG) typed by a user with PROMO_OVERRIDE; null = what the promotion gives. */
  freeQty: string | null;
}

/** Numbers typed in the screen, as the API expects them ("1 500,5" -> "1500.5"). */
const normalized = (v: string, fallback = '0') => parseDA(v)?.toString() ?? fallback;

export function SaleScreen({
  draft,
  initialLines,
  initialClient,
  levels,
  settings,
}: {
  draft: SaleDto | null;
  initialLines: ScreenLine[];
  initialClient: ClientDto | null;
  levels: PriceLevelDto[];
  settings: TenantSettingsResponse;
}) {
  const t = useTranslations('sales');
  const errorMessage = useErrorMessage();
  const { print } = usePrint();
  const unitLabel = useUnitLabel();
  const router = useRouter();
  const queryClient = useQueryClient();
  const canOverride = useCanManageCredit();

  const [draftRef, setDraftRef] = useState(draft ? { id: draft.id, version: draft.version } : null);
  const [type, setType] = useState<SaleType>(draft?.type ?? SaleType.BL);
  const [picked, setPicked] = useState<ClientDto | null>(initialClient);
  const [lines, setLines] = useState<ScreenLine[]>(initialLines);
  const [selected, setSelected] = useState(Math.max(initialLines.length - 1, 0));
  const [paid, setPaid] = useState<string | null>(null);
  const [mode, setMode] = useState<PaymentMode>('ESPECES');
  const [force, setForce] = useState(false);
  const [code, setCode] = useState('');
  const [results, setResults] = useState<ProductDto[] | null>(null);
  const [resultIndex, setResultIndex] = useState(0);
  const [looking, setLooking] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Who made the sale (phase 14): office roles pick it; a seller's sales are his (API).
  const office = useIsOffice();
  const sellers = useSellers();
  const [sellerChoice, setSellerChoice] = useState<string | null>(null);
  // The dépôt the goods leave from (phase 15); '' = the seller's truck, else MAIN (API).
  const warehousesOn = useFeature(Feature.WAREHOUSES);
  const [warehouseChoice, setWarehouseChoice] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const paidRef = useRef<HTMLInputElement>(null);
  /** Same body = same key (a retry is a replay); any change = a new operation. */
  const attempt = useRef<{ body: string; key: string } | null>(null);

  // Fresh balance after each sale; the picked row is the fallback while loading.
  const live = useClient(picked?.id ?? '');
  const client = picked ? (live.data ?? picked) : null;
  const levelId = effectiveLevel(levels, client?.priceLevelId);
  // Until the user picks one: the draft's seller, else the client's assigned seller.
  const sellerId = sellerChoice ?? draft?.sellerId ?? client?.assignedSeller?.id ?? '';
  const warehouseId = warehouseChoice ?? draft?.warehouse?.id ?? '';
  // Phase 24: the search lists what the sale's dépôt (else the header's) sells.
  const headerWarehouseId = useWarehouseFilter();
  const searchWarehouseId = warehouseId || headerWarehouseId;

  const unitPrice = (l: ScreenLine) => l.price ?? listPrice(l.product, l.unitId, levelId);
  // Phase 20: the API's preview says which promotion each line gets (display only).
  const promos = useSalePromotions(
    client?.id ?? null,
    lines.map((l) => ({
      productId: l.product.id,
      unitId: l.unitId,
      qty: normalized(l.qty),
      ...(l.price !== null ? { unitPriceHt: normalized(l.price) } : {}),
      discountPct: normalized(l.discount),
      ...(l.freeQty !== null ? { freeQty: normalized(l.freeQty) } : {}),
    })),
  );
  /** A remise left at 0 takes the promotion's, as the API will. */
  const discountOf = (l: ScreenLine, i: number) => {
    const typed = parseDA(l.discount) ?? money(0);
    const promo = promos.byIndex.get(i)?.paid;
    return typed.isZero() && promo?.promotion ? promo.discountPct : typed.toString();
  };
  const totals = useMemo(
    () =>
      computeTotals(
        lines.map((l, i) => ({
          qty: parseDA(l.qty) ?? '0',
          unitPrice: parseDA(l.price ?? listPrice(l.product, l.unitId, levelId) ?? '0') ?? '0',
          tvaRate: l.product.tvaRate,
          discountPct: discountOf(l, i),
        })),
        settings.assujettiTva,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- discountOf reads promos.byIndex
    [lines, levelId, settings.assujettiTva, promos.byIndex],
  );
  const packagingOn = useFeature(Feature.PACKAGING);
  const [returned, setReturned] = useState<Record<string, string>>({});
  const ttc = totals.totalTtc;
  // Preview of the timbre the API adds when this facture is paid in cash.
  const cashTimbre = computeTimbre({
    ttc,
    saleType: type,
    paymentMode: mode,
    rule: {
      enabled: settings.timbreEnabled,
      threshold: settings.timbreThreshold,
      tranches: settings.timbreTranches,
      min: settings.timbreMin,
      max: settings.timbreMax,
    },
  });
  const paidText = paid ?? (client ? '' : formatDA(ttc.plus(cashTimbre), { currency: false }));
  const handed = parseDA(paidText) ?? money(0);
  const timbre = handed.gt(0) ? cashTimbre : money(0);
  const due = ttc.plus(timbre);
  const kept = handed.gt(due) ? due : handed;
  const change = handed.minus(kept);
  const credit = due.minus(kept);
  const projected = client ? money(client.balance).plus(credit) : null;
  const overLimit =
    client?.creditLimit != null && projected !== null && projected.gt(client.creditLimit);
  const blockMode = settings.creditLimitMode === 'BLOCK';
  const missingPrice = lines.some((l) => unitPrice(l) === null);
  const badQty = lines.some((l) => !parseDA(l.qty)?.gt(0));
  const needsClient = credit.gt(0) && !client;
  const blocked = overLimit && blockMode && !force;
  const canValidate =
    lines.length > 0 &&
    !missingPrice &&
    !badQty &&
    !needsClient &&
    !blocked &&
    parseDA(paidText) !== null;

  const focusScan = () => scanRef.current?.focus();

  function addProduct(product: ProductDto, unitId: string) {
    const existing = lines.findIndex((l) => l.product.id === product.id && l.unitId === unitId);
    if (existing >= 0) {
      changeQty(existing, 1);
      setSelected(existing);
    } else {
      setLines((ls) => [
        ...ls,
        {
          key: crypto.randomUUID(),
          product,
          unitId,
          qty: '1',
          price: null,
          discount: '0',
          freeQty: null,
        },
      ]);
      setSelected(lines.length);
    }
    setResults(null);
    setCode('');
    focusScan();
  }

  /** A scanned barcode gives its unit; a typed reference sells by the default sale unit. */
  function unitFor(product: ProductDto, typed: string): string {
    const byBarcode = product.units.find((u) => u.barcode === typed);
    return (
      byBarcode?.unitId ?? product.units.find((u) => u.isDefaultSale)?.unitId ?? product.baseUnitId
    );
  }

  async function lookup() {
    const value = code.trim();
    if (!value || looking) return;
    setLooking(true);
    try {
      const found = await findProductByCode(value);
      if (found) {
        addProduct(found.product, unitFor(found.product, value));
        return;
      }
      const page = await api.request<ProductPage>(
        `/products?search=${encodeURIComponent(value)}&limit=8${
          searchWarehouseId ? `&warehouseId=${searchWarehouseId}` : ''
        }`,
      );
      const items = page.items.filter((p) => p.active && !p.archivedAt);
      if (items.length === 0) toast.error(t('notFound', { code: value }));
      else if (items.length === 1 && items[0]) addProduct(items[0], unitFor(items[0], value));
      else {
        setResults(items);
        setResultIndex(0);
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLooking(false);
    }
  }

  function changeQty(index: number, delta: number) {
    setLines((ls) =>
      ls.map((l, i) => {
        if (i !== index) return l;
        const next = (parseDA(l.qty) ?? money(0)).plus(delta);
        return { ...l, qty: next.gt(0) ? next.toString() : l.qty };
      }),
    );
  }

  function patchLine(index: number, patch: Partial<ScreenLine>) {
    setLines((ls) => ls.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function removeLine(index: number) {
    setLines((ls) => ls.filter((_, i) => i !== index));
    setSelected((s) => Math.max(0, Math.min(s, lines.length - 2)));
    focusScan();
  }

  function reset() {
    setDraftRef(null);
    setPicked(null);
    setSellerChoice(null);
    setLines([]);
    setSelected(0);
    setPaid(null);
    setMode('ESPECES');
    setForce(false);
    setReturned({});
    attempt.current = null;
    if (draft) router.replace('/ventes/nouvelle');
    focusScan();
  }

  const header = () => ({
    type,
    clientId: client?.id ?? null,
    documentDate: todayInAlgiers(),
    note: draft?.note ?? '',
    ...(office ? { sellerId: sellerId || null } : {}),
    ...(warehousesOn ? { warehouseId: warehouseId || null } : {}),
    lines: lines.map((l) => ({
      productId: l.product.id,
      unitId: l.unitId,
      qty: normalized(l.qty),
      ...(l.price !== null ? { unitPriceHt: normalized(l.price) } : {}),
      discountPct: normalized(l.discount),
      ...(l.freeQty !== null ? { freeQty: normalized(l.freeQty) } : {}),
    })),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: saleKeys.all });
    void queryClient.invalidateQueries({ queryKey: stockKeys.all });
    void queryClient.invalidateQueries({ queryKey: clientKeys.all });
  };

  const geo = useGeoSubmit();
  const validate = useMutation({
    mutationFn: async () => {
      const payment = {
        paidAmount: normalized(paidText),
        paymentMode: mode,
        forceCredit: force,
        ...(packagingOn && client ? { packagingReturned: packagingReturnedInput(returned) } : {}),
      };
      const body = { ...header(), ...payment };
      const signature = JSON.stringify({ draft: draftRef, body });
      if (attempt.current?.body !== signature) {
        attempt.current = { body: signature, key: crypto.randomUUID() };
      }
      const key = attempt.current.key;
      // Phase 17: the seller's position goes with the validation (a note if asked).
      const withGeo = (b: object, g: GeoInput | undefined) => (g ? { ...b, geo: g } : b);
      if (!draftRef) {
        return geo.run((g) =>
          api.request<SaleResultDto>('/sales/quick', {
            method: 'POST',
            body: withGeo(body, g),
            idempotencyKey: key,
          }),
        );
      }
      const saved = await api.request<SaleDto>(`/sales/${draftRef.id}`, {
        method: 'PUT',
        body: { ...header(), version: draftRef.version },
      });
      setDraftRef({ id: saved.id, version: saved.version });
      return geo.run((g) =>
        api.request<SaleResultDto>(`/sales/${saved.id}/validate`, {
          method: 'POST',
          body: withGeo(payment, g),
          idempotencyKey: key,
        }),
      );
    },
    onSuccess: (result) => {
      invalidate();
      geo.after(result.geoCheck, result.sale.client?.id ?? null);
      const docType = result.sale.type === SaleType.FACTURE ? 'FAC' : 'BL';
      toast.success(t('validatedToast', { number: result.sale.number ?? '' }), {
        duration: 10000,
        action: {
          label: t('print'),
          onClick: () => void print(`/documents/${docType}/${result.sale.id}/pdf`),
        },
        cancel: { label: t('open'), onClick: () => router.push(`/ventes/${result.sale.id}`) },
      });
      if (money(result.change).gt(0)) {
        toast.info(t('changeToast', { amount: isolateLtr(formatDA(result.change)) }), {
          duration: 10000,
        });
      }
      for (const w of result.warnings) {
        toast.warning(
          w.kind === 'NEGATIVE_STOCK'
            ? t('warnNegative', { after: formatQty(w.after) })
            : w.kind === 'PACKAGING_NEGATIVE'
              ? t('warnPackagingNegative', { count: w.balance })
              : t(w.forced ? 'warnCreditForced' : 'warnCredit', {
                  projected: isolateLtr(formatDA(w.projected)),
                }),
        );
      }
      reset();
    },
    onError: (err) => {
      if (!isGeoCancelled(err)) toast.error(errorMessage(err));
    },
  });

  const saveDraft = useMutation({
    mutationFn: () =>
      draftRef
        ? api.request<SaleDto>(`/sales/${draftRef.id}`, {
            method: 'PUT',
            body: { ...header(), version: draftRef.version },
          })
        : api.request<SaleDto>('/sales', { method: 'POST', body: header() }),
    onSuccess: (saved) => {
      invalidate();
      toast.success(t('draftSaved'), {
        action: { label: t('open'), onClick: () => router.push(`/ventes/${saved.id}`) },
      });
      reset();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const busy = validate.isPending || saveDraft.isPending;

  // Function keys work from anywhere on the screen.
  const onShortcut = useEffectEvent((e: KeyboardEvent) => {
    if (pickerOpen) return;
    if (e.key === 'F2') setPickerOpen(true);
    else if (e.key === 'F3') setType((v) => (v === SaleType.BL ? SaleType.FACTURE : SaleType.BL));
    else if (e.key === 'F4') {
      paidRef.current?.focus();
      paidRef.current?.select();
    } else if (e.key === 'F8') {
      if (lines.length > 0 && !busy) saveDraft.mutate();
    } else if (e.key === 'F9') {
      if (canValidate && !busy) validate.mutate();
    } else return;
    e.preventDefault();
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onShortcut(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  function onScanKey(e: React.KeyboardEvent<HTMLInputElement>) {
    const empty = code === '';
    if (e.key === 'Enter') {
      e.preventDefault();
      const r = results?.[resultIndex];
      if (r) addProduct(r, unitFor(r, code.trim()));
      else void lookup();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      if (results) setResultIndex((i) => Math.max(0, Math.min(results.length - 1, i + step)));
      else setSelected((s) => Math.max(0, Math.min(lines.length - 1, s + step)));
    } else if ((e.key === '+' || e.key === '-') && empty && lines[selected]) {
      e.preventDefault();
      changeQty(selected, e.key === '+' ? 1 : -1);
    } else if (e.key === 'Delete' && empty && lines[selected]) {
      e.preventDefault();
      removeLine(selected);
    } else if (e.key === 'Escape') {
      setResults(null);
      setCode('');
    }
  }

  const backToScan = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      focusScan();
    }
  };

  const isMobile = useIsMobile();

  /** The editors of one line, shared by the desktop table and the phone cards. */
  function lineEditors(l: ScreenLine, i: number) {
    const price = unitPrice(l);
    return {
      unit: (
        <NativeSelect
          aria-label={t('unitOf', { product: l.product.designation })}
          value={l.unitId}
          onChange={(e) => patchLine(i, { unitId: e.target.value, price: null })}
        >
          {l.product.units.map((u) => (
            <option key={u.unitId} value={u.unitId}>
              {unitLabel({ code: u.unitCode, name: u.unitName })}
              {u.unitId !== l.product.baseUnitId ? ` ×${formatQty(u.factorToBase)}` : ''}
            </option>
          ))}
        </NativeSelect>
      ),
      qty: (
        <Input
          aria-label={t('qtyOf', { product: l.product.designation })}
          dir="ltr"
          inputMode="decimal"
          className="num text-center md:text-start"
          aria-invalid={!parseDA(l.qty)?.gt(0)}
          value={l.qty}
          onChange={(e) => patchLine(i, { qty: e.target.value })}
          onFocus={() => setSelected(i)}
          onKeyDown={backToScan}
        />
      ),
      price: canOverride ? (
        <Input
          aria-label={t('priceOf', { product: l.product.designation })}
          dir="ltr"
          inputMode="decimal"
          className="num"
          placeholder={t('noPrice')}
          value={l.price ?? (price ? formatDA(price, { currency: false }) : '')}
          onChange={(e) => patchLine(i, { price: e.target.value })}
          onFocus={() => setSelected(i)}
          onKeyDown={backToScan}
        />
      ) : price ? (
        <Amount value={price} currency={false} />
      ) : (
        <Badge variant="destructive">{t('noPrice')}</Badge>
      ),
      discount: canOverride ? (
        <Input
          aria-label={t('discountOf', { product: l.product.designation })}
          dir="ltr"
          inputMode="decimal"
          className="num"
          value={l.discount}
          onChange={(e) => patchLine(i, { discount: e.target.value })}
          onFocus={() => setSelected(i)}
          onKeyDown={backToScan}
        />
      ) : (
        <span dir="ltr" className="num text-muted-foreground">
          {l.discount} %
        </span>
      ),
      total: (
        <Amount value={totals.lines[i]?.lineHt ?? '0'} currency={false} className="font-medium" />
      ),
      remove: (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('remove', { product: l.product.designation })}
          onClick={(e) => {
            e.stopPropagation();
            removeLine(i);
          }}
        >
          <Trash2 aria-hidden />
        </Button>
      ),
    };
  }

  return (
    <>
      <PageHeader
        title={draftRef ? t('draftTitle') : t('newTitle')}
        description={t('screenHelp')}
        actions={
          <div
            role="radiogroup"
            aria-label={t('docType')}
            className="flex rounded-md border p-0.5 md:inline-flex"
          >
            {[SaleType.BL, SaleType.FACTURE].map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={type === v}
                onClick={() => setType(v)}
                className={cn(
                  'min-h-10 flex-1 rounded px-4 py-1.5 text-sm font-medium transition-colors md:min-h-0 md:flex-none md:px-3',
                  type === v
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t(`type${v}`)}
              </button>
            ))}
            <span className="sr-only">F3</span>
          </div>
        }
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="gap-4 py-4">
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="scan">{t('scanLabel')}</Label>
              <div className="relative">
                <ScanBarcode
                  className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="scan"
                  type="search"
                  enterKeyHint="search"
                  ref={scanRef}
                  autoFocus
                  autoComplete="off"
                  role="combobox"
                  aria-expanded={results !== null}
                  aria-controls="scan-results"
                  aria-activedescendant={results ? `scan-result-${resultIndex}` : undefined}
                  aria-describedby="scan-hint"
                  className="h-11 ps-9 text-base"
                  placeholder={t('scanPlaceholder')}
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    setResults(null);
                  }}
                  onKeyDown={onScanKey}
                />
                {looking ? (
                  <Loader2
                    className="absolute end-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
                    aria-hidden
                  />
                ) : null}
              </div>
              <p
                id="scan-hint"
                // Shortcuts need a keyboard: hidden on a phone (still read by screen readers).
                className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground max-md:sr-only"
              >
                <span>
                  <Kbd>{t('keyEnter')}</Kbd> {t('hintAdd')}
                </span>
                <span>
                  <Kbd>↑</Kbd>
                  <Kbd>↓</Kbd> {t('hintSelect')}
                </span>
                <span>
                  <Kbd>+</Kbd>
                  <Kbd>-</Kbd> {t('hintQty')}
                </span>
                <span>
                  <Kbd>{t('keyDelete')}</Kbd> {t('hintRemove')}
                </span>
                <span>
                  <Kbd>F2</Kbd> {t('hintClient')}
                </span>
                <span>
                  <Kbd>F3</Kbd> {t('hintType')}
                </span>
                <span>
                  <Kbd>F4</Kbd> {t('hintPay')}
                </span>
                <span>
                  <Kbd>F8</Kbd> {t('hintDraft')}
                </span>
                <span>
                  <Kbd>F9</Kbd> {t('hintValidate')}
                </span>
              </p>
              {results ? (
                <ul
                  id="scan-results"
                  role="listbox"
                  aria-label={t('results')}
                  className="rounded-md border"
                >
                  {results.map((p, i) => (
                    <li
                      key={p.id}
                      id={`scan-result-${i}`}
                      role="option"
                      aria-selected={i === resultIndex}
                      className={cn(
                        'flex min-h-11 cursor-pointer items-center justify-between gap-3 border-b px-3 py-2 text-sm last:border-b-0',
                        i === resultIndex && 'bg-accent text-accent-foreground',
                      )}
                      onMouseEnter={() => setResultIndex(i)}
                      onClick={() => addProduct(p, unitFor(p, ''))}
                    >
                      <span className="truncate">{p.designation}</span>
                      <span dir="ltr" className="shrink-0 text-xs text-muted-foreground">
                        {p.reference}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {isMobile ? (
              <ul aria-label={t('linesCaption')} className="divide-y rounded-lg border">
                {lines.length === 0 ? (
                  <li className="py-10 text-center text-sm text-muted-foreground">
                    {t('noLines')}
                  </li>
                ) : (
                  lines.map((l, i) => {
                    const ed = lineEditors(l, i);
                    return (
                      <li
                        key={l.key}
                        data-state={i === selected ? 'selected' : undefined}
                        className="space-y-3 p-3 data-[state=selected]:bg-primary/5"
                        onClick={() => setSelected(i)}
                      >
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{l.product.designation}</p>
                            <p
                              dir="ltr"
                              className="truncate text-xs text-muted-foreground rtl:text-end"
                            >
                              {l.product.reference}
                            </p>
                          </div>
                          {ed.remove}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="col-span-2 flex items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              aria-label={t('qtyLess', { product: l.product.designation })}
                              onClick={() => changeQty(i, -1)}
                            >
                              <Minus aria-hidden />
                            </Button>
                            <div className="flex-1">{ed.qty}</div>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              aria-label={t('qtyMore', { product: l.product.designation })}
                              onClick={() => changeQty(i, 1)}
                            >
                              <Plus aria-hidden />
                            </Button>
                          </div>
                          <div className="col-span-2">{ed.unit}</div>
                          <div className="space-y-1">
                            <p className="text-xs text-muted-foreground">{t('colPrice')}</p>
                            {ed.price}
                          </div>
                          <div className="space-y-1">
                            <p className="text-xs text-muted-foreground">{t('colDiscount')}</p>
                            {ed.discount}
                          </div>
                        </div>
                        <PromoNote
                          promo={promos.byIndex.get(i)}
                          freeQty={l.freeQty}
                          onFreeQty={(v) => patchLine(i, { freeQty: v })}
                        />
                        <div className="flex items-baseline justify-between gap-2 text-sm">
                          <span className="text-muted-foreground">{t('colLineHt')}</span>
                          {ed.total}
                        </div>
                      </li>
                    );
                  })
                )}
              </ul>
            ) : (
              <div className="w-full overflow-x-auto rounded-lg border">
                <Table className="min-w-[44rem]">
                  <caption className="sr-only">{t('linesCaption')}</caption>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead>{t('colProduct')}</TableHead>
                      <TableHead>{t('colUnit')}</TableHead>
                      <TableHead className="w-24">{t('colQty')}</TableHead>
                      <TableHead className="w-32">{t('colPrice')}</TableHead>
                      <TableHead className="w-20">{t('colDiscount')}</TableHead>
                      <TableHead className="text-end">{t('colLineHt')}</TableHead>
                      <TableHead className="w-10">
                        <span className="sr-only">{t('colActions')}</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                          {t('noLines')}
                        </TableCell>
                      </TableRow>
                    ) : (
                      lines.map((l, i) => {
                        const ed = lineEditors(l, i);
                        const promo = promos.byIndex.get(i);
                        return (
                          <Fragment key={l.key}>
                            <TableRow
                              data-state={i === selected ? 'selected' : undefined}
                              className="data-[state=selected]:bg-primary/10 data-[state=selected]:shadow-[inset_3px_0_0_var(--primary)] rtl:data-[state=selected]:shadow-[inset_-3px_0_0_var(--primary)]"
                              onClick={() => setSelected(i)}
                            >
                              <TableCell className="max-w-56 whitespace-normal">
                                <p className="font-medium">{l.product.designation}</p>
                                <p
                                  dir="ltr"
                                  className="text-start text-xs text-muted-foreground rtl:text-end"
                                >
                                  {l.product.reference}
                                </p>
                              </TableCell>
                              <TableCell>{ed.unit}</TableCell>
                              <TableCell>{ed.qty}</TableCell>
                              <TableCell>{ed.price}</TableCell>
                              <TableCell>{ed.discount}</TableCell>
                              <TableCell className="text-end">{ed.total}</TableCell>
                              <TableCell>{ed.remove}</TableCell>
                            </TableRow>
                            {promo?.paid?.promotion || promo?.free.length ? (
                              <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={7} className="pt-0">
                                  <PromoNote
                                    promo={promo}
                                    freeQty={l.freeQty}
                                    onFreeQty={(v) => patchLine(i, { freeQty: v })}
                                  />
                                </TableCell>
                              </TableRow>
                            ) : null}
                          </Fragment>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid content-start gap-4">
          <Card className="gap-3 py-4">
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle role="heading" aria-level={2} className="text-base">
                {t('client')}
              </CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                <UserRound aria-hidden />
                {t('changeClient')} <Kbd className="ms-1">F2</Kbd>
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {client ? (
                <>
                  <p className="font-medium">{client.name}</p>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">{t('balance')}</span>
                    <BalanceAmount value={client.balance} />
                  </div>
                  {client.creditLimit !== null && projected ? (
                    <div className="space-y-1">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="text-muted-foreground">{t('afterSale')}</span>
                        <span
                          dir="ltr"
                          className={cn('num font-medium', overLimit && 'text-destructive')}
                        >
                          <Amount value={projected} />
                        </span>
                      </div>
                      <PlafondBar
                        usage={Math.min(
                          100,
                          Math.max(
                            0,
                            money(client.creditLimit).isZero()
                              ? 100
                              : projected.div(client.creditLimit).times(100).round().toNumber(),
                          ),
                        )}
                        label={t('plafondOf', { limit: isolateLtr(formatDA(client.creditLimit)) })}
                      />
                      <p className="text-xs text-muted-foreground">
                        {t('plafondOf', { limit: isolateLtr(formatDA(client.creditLimit)) })}
                      </p>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{t('counterClientHelp')}</p>
              )}
              {office ? (
                <div className="space-y-1 pt-1">
                  <Label htmlFor="sale-seller">{t('seller')}</Label>
                  <NativeSelect
                    id="sale-seller"
                    value={sellerId}
                    onChange={(e) => setSellerChoice(e.target.value)}
                  >
                    <option value="">{t('noSeller')}</option>
                    {(sellers.data ?? []).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.fullName}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              ) : null}
              <WarehouseSelect
                id="sale-warehouse"
                value={warehouseId}
                onChange={setWarehouseChoice}
                defaultLabel={t('warehouseAuto')}
              />
              {overLimit ? (
                <Alert variant={blockMode ? 'destructive' : 'default'} role="alert">
                  <AlertDescription className="space-y-2">
                    <p>{blockMode ? t('overLimitBlock') : t('overLimitWarn')}</p>
                    {blockMode && canOverride ? (
                      <div className="flex items-center gap-2">
                        <Switch id="force" checked={force} onCheckedChange={setForce} />
                        <Label htmlFor="force">{t('forceCredit')}</Label>
                      </div>
                    ) : null}
                  </AlertDescription>
                </Alert>
              ) : null}
              {geo.on && client ? <GeoPrivacyNotice /> : null}
            </CardContent>
          </Card>

          {packagingOn && client ? (
            <PackagingReturnedCard clientId={client.id} value={returned} onChange={setReturned} />
          ) : null}

          <Card className="gap-3 py-4">
            <CardHeader>
              <CardTitle role="heading" aria-level={2} className="text-base">
                {t('totals')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t('totalHt')}</dt>
                  <dd dir="ltr" className="num">
                    <Amount value={totals.totalHt} />
                  </dd>
                </div>
                {totals.tvaByRate.map((r) => (
                  <div key={r.rate.toString()} className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">
                      {t('tvaAt', { rate: r.rate.toString() })}
                    </dt>
                    <dd dir="ltr" className="num">
                      <Amount value={r.tva} />
                    </dd>
                  </div>
                ))}
                <div className="flex items-baseline justify-between gap-2 border-t pt-2">
                  <dt className="font-medium">{t('totalTtc')}</dt>
                  <dd dir="ltr" className="num text-2xl font-semibold">
                    <Amount value={ttc} />
                  </dd>
                </div>
                {timbre.gt(0) ? (
                  <>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">{t('timbre')}</dt>
                      <dd dir="ltr" className="num">
                        <Amount value={timbre} />
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="font-medium">{t('netToPay')}</dt>
                      <dd dir="ltr" className="num text-lg font-semibold">
                        <Amount value={due} />
                      </dd>
                    </div>
                  </>
                ) : null}
              </dl>
            </CardContent>
          </Card>

          <Card className="gap-3 py-4">
            <CardHeader>
              <CardTitle role="heading" aria-level={2} className="text-base">
                {t('payment')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="paid" className="gap-1">
                    {t('paid')} <Kbd>F4</Kbd>
                  </Label>
                  <Input
                    id="paid"
                    ref={paidRef}
                    dir="ltr"
                    inputMode="decimal"
                    className="num"
                    placeholder="0"
                    aria-invalid={parseDA(paidText) === null}
                    value={paidText}
                    onChange={(e) => setPaid(e.target.value)}
                    onKeyDown={backToScan}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="mode">{t('mode')}</Label>
                  <NativeSelect
                    id="mode"
                    value={mode}
                    onChange={(e) => setMode(e.target.value as PaymentMode)}
                  >
                    {PAYMENT_MODES.map((m) => (
                      <option key={m} value={m}>
                        {t(`mode${m}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </div>
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t('onCredit')}</dt>
                  <dd
                    dir="ltr"
                    className={cn('num font-medium', credit.gt(0) && 'text-destructive')}
                  >
                    <Amount value={credit} />
                  </dd>
                </div>
                {change.gt(0) ? (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{t('change')}</dt>
                    <dd dir="ltr" className="num font-semibold text-primary">
                      <Amount value={change} />
                    </dd>
                  </div>
                ) : null}
              </dl>
              {needsClient ? (
                <p role="status" className="text-sm text-destructive">
                  {t('needsClient')}
                </p>
              ) : null}
              {missingPrice ? (
                <p role="status" className="text-sm text-destructive">
                  {t('missingPrice')}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <StickyActions className="grid grid-cols-2 gap-2 md:grid">
            <p className="col-span-2 flex items-baseline justify-between gap-2 md:hidden">
              <span className="text-sm text-muted-foreground">
                {timbre.gt(0) ? t('netToPay') : t('totalTtc')}
              </span>
              <Amount value={timbre.gt(0) ? due : ttc} className="text-xl font-semibold" />
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={lines.length === 0 || busy}
              onClick={() => saveDraft.mutate()}
            >
              {saveDraft.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Save aria-hidden />
              )}
              {t('saveDraft')} <Kbd>F8</Kbd>
            </Button>
            <Button type="button" disabled={!canValidate || busy} onClick={() => validate.mutate()}>
              {validate.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Check aria-hidden />
              )}
              {t('validate')}{' '}
              <Kbd className="border-primary-foreground/30 bg-primary-foreground/15 text-primary-foreground">
                F9
              </Kbd>
            </Button>
          </StickyActions>
        </div>
      </div>

      {geo.dialog}
      <ClientPicker
        open={pickerOpen}
        onOpenChange={(o) => {
          setPickerOpen(o);
          if (!o) setTimeout(focusScan, 0);
        }}
        onPick={(c) => {
          setPicked(c);
          setForce(false);
        }}
      />
    </>
  );
}
