'use client';

import { ArrowLeft, Download, Loader2, Tags } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { monthToDate, Permission, SELL_OUT_COLUMNS, type SellOutRowDto } from '@erp/shared';
import { Amount } from '@/components/shared/amount';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usePermission } from '@/lib/auth';
import { downloadSellOut, type SellOutParams, useSellOut } from '@/lib/distribution';
import { todayInAlgiers } from '@/lib/purchases';
import { useBrands, useSectors, useSellers } from '@/lib/sales-force';
import { formatQty } from '@/lib/stock';
import { useErrorMessage } from '@/lib/use-error-message';
import { cn } from '@/lib/utils';

type Key = (typeof SELL_OUT_COLUMNS)[number]['key'];
const QTY: ReadonlySet<Key> = new Set(['qtySold', 'qtyFree', 'qtyReturned', 'qtyNet']);
const MONEY: ReadonlySet<Key> = new Set(['salesHt', 'returnsHt', 'netHt', 'freeValueHt']);

/**
 * Sell-out par marque (phase 20): what went out to the clients, by month, brand, product,
 * sector, seller and client type. The Excel export keeps fixed column titles for the brands.
 */
export function SellOutReport() {
  const t = useTranslations('sellOut');
  const tr = useTranslations('reports');
  const errorMessage = useErrorMessage();
  const canExport = usePermission(Permission.EXPORT_DATA);
  const month = monthToDate(todayInAlgiers());
  const [params, setParams] = useState<SellOutParams>({
    from: month.from,
    to: month.to,
    brandId: '',
    sectorId: '',
    sellerId: '',
    clientType: '',
  });
  const invalidRange = params.from > params.to;
  const report = useSellOut(params);
  const brands = useBrands();
  const sectors = useSectors();
  const sellers = useSellers();
  const [exporting, setExporting] = useState(false);
  const set = (patch: Partial<SellOutParams>) => setParams((p) => ({ ...p, ...patch }));

  const exportXlsx = async () => {
    setExporting(true);
    try {
      await downloadSellOut(params);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  const text = (r: SellOutRowDto, k: Key): string => {
    switch (k) {
      case 'brand':
        return r.brand ?? t('noBrand');
      case 'sector':
        return r.sector ?? '—';
      case 'seller':
        return r.seller ?? '—';
      case 'clientType':
        return r.clientType ? t(`clientType${r.clientType}`) : t('counter');
      default:
        return String(r[k]);
    }
  };

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        more={[
          { label: tr('title'), icon: ArrowLeft, flipIcon: true, tone: 'ghost', href: '/rapports' },
        ]}
        actions={
          canExport ? (
            <Button
              onClick={() => void exportXlsx()}
              disabled={exporting || invalidRange || !report.data}
            >
              {exporting ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Download aria-hidden />
              )}
              {tr('export')}
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 gap-3 md:flex md:flex-wrap md:items-end">
        <div className="space-y-1">
          <Label htmlFor="so-from">{tr('from')}</Label>
          <Input
            id="so-from"
            type="date"
            value={params.from}
            onChange={(e) => set({ from: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="so-to">{tr('to')}</Label>
          <Input
            id="so-to"
            type="date"
            aria-invalid={invalidRange}
            value={params.to}
            onChange={(e) => set({ to: e.target.value })}
          />
        </div>
        <div className="col-span-2 space-y-1 md:w-48">
          <Label htmlFor="so-brand">{tr('filterBrand')}</Label>
          <NativeSelect
            id="so-brand"
            value={params.brandId}
            onChange={(e) => set({ brandId: e.target.value })}
          >
            <option value="">{tr('allBrands')}</option>
            {(brands.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1 md:w-44">
          <Label htmlFor="so-sector">{t('sector')}</Label>
          <NativeSelect
            id="so-sector"
            value={params.sectorId}
            onChange={(e) => set({ sectorId: e.target.value })}
          >
            <option value="">{t('allSectors')}</option>
            {(sectors.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1 md:w-44">
          <Label htmlFor="so-seller">{tr('filterSeller')}</Label>
          <NativeSelect
            id="so-seller"
            value={params.sellerId}
            onChange={(e) => set({ sellerId: e.target.value })}
          >
            <option value="">{tr('allSellers')}</option>
            {(sellers.data ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="col-span-2 space-y-1 md:w-44">
          <Label htmlFor="so-type">{t('clientType')}</Label>
          <NativeSelect
            id="so-type"
            value={params.clientType}
            onChange={(e) => set({ clientType: e.target.value })}
          >
            <option value="">{t('allClientTypes')}</option>
            <option value="PARTICULIER">{t('clientTypePARTICULIER')}</option>
            <option value="PROFESSIONNEL">{t('clientTypePROFESSIONNEL')}</option>
          </NativeSelect>
        </div>
      </div>

      {invalidRange ? (
        <p role="alert" className="text-sm text-destructive">
          {tr('invalidRange')}
        </p>
      ) : report.isPending ? (
        <Skeleton className="h-64 w-full" aria-busy />
      ) : report.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(report.error)}
        </p>
      ) : report.data.rows.length === 0 ? (
        <EmptyState icon={Tags} title={t('empty')} description={t('emptyHelp')} />
      ) : (
        <>
          {report.data.truncated ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t('truncated')}
            </p>
          ) : null}
          <div
            // An office report: on a phone it scrolls in its own box, first column pinned.
            data-scroll-x=""
            className={cn(
              'w-full overflow-x-auto rounded-lg border bg-card transition-opacity',
              '[&_tr>*:first-child]:sticky [&_tr>*:first-child]:start-0 [&_tr>*:first-child]:z-10 [&_td:first-child]:bg-card [&_th:first-child]:bg-muted',
              report.isPlaceholderData && 'opacity-60',
            )}
          >
            <Table className="min-w-[72rem]">
              <caption className="sr-only">{t('title')}</caption>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  {SELL_OUT_COLUMNS.map((c) => (
                    <TableHead
                      key={c.key}
                      className={cn((QTY.has(c.key) || MONEY.has(c.key)) && 'text-end')}
                    >
                      {t(`col.${c.key}`)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.data.rows.map((r, i) => (
                  <TableRow key={i}>
                    {SELL_OUT_COLUMNS.map((c) => (
                      <TableCell
                        key={c.key}
                        className={cn(
                          (QTY.has(c.key) || MONEY.has(c.key)) && 'text-end',
                          c.key === 'designation' && 'max-w-56 truncate',
                        )}
                        title={c.key === 'designation' ? r.designation : undefined}
                      >
                        {QTY.has(c.key) ? (
                          <span dir="ltr" className="num whitespace-nowrap">
                            {formatQty(r[c.key as 'qtySold'])}
                          </span>
                        ) : MONEY.has(c.key) ? (
                          <Amount value={r[c.key as 'salesHt']} currency={false} />
                        ) : (
                          text(r, c.key)
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  {SELL_OUT_COLUMNS.map((c, i) => (
                    <TableCell
                      key={c.key}
                      className={cn(
                        'font-semibold',
                        (QTY.has(c.key) || MONEY.has(c.key)) && 'text-end',
                      )}
                    >
                      {QTY.has(c.key) ? (
                        <span dir="ltr" className="num whitespace-nowrap">
                          {formatQty(report.data.totals[c.key as 'qtySold'])}
                        </span>
                      ) : MONEY.has(c.key) ? (
                        <Amount value={report.data.totals[c.key as 'salesHt']} currency={false} />
                      ) : i === 0 ? (
                        tr('total')
                      ) : null}
                    </TableCell>
                  ))}
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </>
      )}
    </>
  );
}
