'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Link2, Loader2, Lock, Pencil, Plus, Trash2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { ErrorCode, Feature, type ImportFileDto, qty } from '@erp/shared';
import { PurchaseStatusBadge } from '@/components/purchases/purchase-status-badge';
import { Amount } from '@/components/shared/amount';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
import { PrintButton } from '@/components/shared/print-button';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { importFileKeys, useImportFile, useLandedCostPreview } from '@/lib/import-files';
import { purchaseKeys } from '@/lib/purchases';
import { formatQty, stockKeys } from '@/lib/stock';
import { useErrorMessage } from '@/lib/use-error-message';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';
import { AttachPurchaseDialog } from './attach-purchase-dialog';
import { ImportCostDialog } from './import-cost-dialog';
import { ImportFileFormDialog } from './import-file-form-dialog';
import { ImportFileStatusBadge } from './import-file-status-badge';

/** One dossier d'importation: its BRs, its costs, the allocation preview and the close. */
export function ImportFileDetail({ id }: { id: string }) {
  return (
    <FeatureGate feature={Feature.IMPORT_COSTS}>
      <Detail id={id} />
    </FeatureGate>
  );
}

type Dialog = 'edit' | 'attach' | 'cost' | 'late' | 'cancelFile' | { cancelCost: string } | null;

function Detail({ id }: { id: string }) {
  const t = useTranslations('importFiles');
  const tp = useTranslations('purchases');
  const te = useTranslations('errors');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const file = useImportFile(id);
  const preview = useLandedCostPreview(id, file.data?.version);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [closeKey] = useState(() => crypto.randomUUID());

  const onSaved = (saved: ImportFileDto) => {
    queryClient.setQueryData(importFileKeys.one(saved.id), saved);
    void queryClient.invalidateQueries({ queryKey: importFileKeys.all });
  };
  const detach = useMutation({
    mutationFn: (purchaseId: string) =>
      api.request<ImportFileDto>(`/import-files/${id}/purchases/${purchaseId}`, {
        method: 'DELETE',
      }),
    onSuccess: (saved) => {
      onSaved(saved);
      void queryClient.invalidateQueries({ queryKey: purchaseKeys.all });
      toast.success(t('detached'));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const close = useMutation({
    mutationFn: () =>
      api.request<ImportFileDto>(`/import-files/${id}/close`, {
        method: 'POST',
        idempotencyKey: closeKey,
      }),
    onSuccess: (saved) => {
      onSaved(saved);
      void queryClient.invalidateQueries({ queryKey: purchaseKeys.all });
      void queryClient.invalidateQueries({ queryKey: stockKeys.all });
      toast.success(t('closed'));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (file.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (file.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{errorMessage(file.error)}</AlertDescription>
      </Alert>
    );
  }

  const f = file.data;
  const isOpen = f.status === 'OPEN';
  const p = preview.data;
  const costName = (c: { type: string; label: string | null }) =>
    c.label ?? t(`costType${c.type}` as 'costTypeFRET');
  const canClose = isOpen && f.purchases.length > 0 && (p?.problems.length ?? 0) === 0;

  return (
    <div className="space-y-4 pb-4">
      <PageHeader
        title={f.number}
        description={[f.reference, f.containerNo].filter(Boolean).join(' / ') || undefined}
        actions={
          <>
            <ImportFileStatusBadge status={f.status} />
            {f.purchases.length > 0 ? <PrintButton path={`/documents/DI/${f.id}/pdf`} /> : null}
            {isOpen ? (
              <Button variant="outline" onClick={() => setDialog('edit')}>
                <Pencil aria-hidden />
                {t('edit')}
              </Button>
            ) : null}
            <Button asChild variant="ghost">
              <Link href="/achats/dossiers">
                <ArrowLeft aria-hidden className="rtl:rotate-180" />
                {t('back')}
              </Link>
            </Button>
          </>
        }
      />

      {/* Information, not an error: announced politely. */}
      <Alert role="status">
        <AlertDescription>
          {isOpen
            ? t('openNotice')
            : f.status === 'CLOSED'
              ? t('closedNotice', {
                  date: format.dateTime(new Date(f.closedAt ?? f.createdAt), {
                    dateStyle: 'medium',
                  }),
                })
              : t('cancelledNotice')}
        </AlertDescription>
      </Alert>

      <Card>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-3">
          <p>
            <span className="text-muted-foreground">{t('arrivalDate')}: </span>
            {f.arrivalDate
              ? format.dateTime(new Date(`${f.arrivalDate}T12:00:00Z`), { dateStyle: 'medium' })
              : '—'}
          </p>
          <p>
            <span className="text-muted-foreground">{t('totalGoods')}: </span>
            <Amount value={f.totalGoods} />
          </p>
          <p>
            <span className="text-muted-foreground">{t('totalCosts')}: </span>
            <Amount value={f.totalCosts} />
          </p>
          <p className="font-semibold sm:col-span-3">
            <span className="text-muted-foreground">{t('totalLanded')}: </span>
            <Amount value={f.totalLanded} />
          </p>
          {f.note ? (
            <p className="sm:col-span-3">
              <span className="text-muted-foreground">{t('note')}: </span>
              {f.note}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">{t('purchasesSection')}</CardTitle>
          {isOpen ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setDialog('attach')}>
                <Link2 aria-hidden />
                {t('attachDraft')}
              </Button>
              <Button asChild size="sm">
                <Link href={`/achats/nouveau?dossier=${f.id}`}>
                  <Plus aria-hidden />
                  {t('newBr')}
                </Link>
              </Button>
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {f.purchases.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">{t('noPurchases')}</p>
          ) : (
            <table className="stack-table w-full text-sm">
              <caption className="sr-only">{t('purchasesSection')}</caption>
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="p-3 text-start font-medium">{t('colNumber')}</th>
                  <th className="p-3 text-start font-medium">{t('colSupplier')}</th>
                  <th className="p-3 text-start font-medium">{t('colStatus')}</th>
                  <th className="p-3 text-end font-medium">{t('colTotal')}</th>
                  {isOpen ? <th className="w-12 p-3" /> : null}
                </tr>
              </thead>
              <tbody>
                {f.purchases.map((b) => (
                  <tr key={b.id} className="border-t">
                    <td data-cell="main" className="p-3 font-medium">
                      <Link
                        href={`/achats/${b.id}`}
                        className="tabular-nums underline underline-offset-4"
                        dir="ltr"
                      >
                        {b.number ?? t('draft')}
                      </Link>
                    </td>
                    <td data-label={t('colSupplier')} className="p-3">
                      {b.supplier.name}
                    </td>
                    <td data-label={t('colStatus')} className="p-3">
                      <PurchaseStatusBadge status={b.status} />
                    </td>
                    <td data-label={t('colTotal')} className="num p-3 text-end whitespace-nowrap">
                      <Amount value={b.totalTtc} />
                      {b.totalCurrency ? (
                        <span className="block text-xs text-muted-foreground" dir="ltr">
                          {b.totalCurrency} {b.currency} × {b.exchangeRate}
                        </span>
                      ) : null}
                    </td>
                    {isOpen ? (
                      <td className="p-3 text-end">
                        {b.status === 'DRAFT' ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t('detach')}
                            disabled={detach.isPending}
                            onClick={() => detach.mutate(b.id)}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">{t('costsSection')}</CardTitle>
          {isOpen ? (
            <Button size="sm" variant="outline" onClick={() => setDialog('cost')}>
              <Plus aria-hidden />
              {t('addCost')}
            </Button>
          ) : f.status === 'CLOSED' ? (
            <Button size="sm" variant="outline" onClick={() => setDialog('late')}>
              <Plus aria-hidden />
              {t('lateCost')}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {f.costs.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">{t('noCosts')}</p>
          ) : (
            <table className="stack-table w-full text-sm">
              <caption className="sr-only">{t('costsSection')}</caption>
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="p-3 text-start font-medium">{t('costType')}</th>
                  <th className="p-3 text-start font-medium">{t('costSupplier')}</th>
                  <th className="p-3 text-start font-medium">{t('method')}</th>
                  <th className="p-3 text-end font-medium">{t('allocated')}</th>
                  {isOpen ? <th className="w-12 p-3" /> : null}
                </tr>
              </thead>
              <tbody>
                {f.costs.map((c) => (
                  <tr
                    key={c.id}
                    className={`border-t${c.cancelledAt ? ' text-muted-foreground line-through' : ''}`}
                  >
                    <td data-cell="main" className="p-3 font-medium">
                      {costName(c)}
                      {c.isLate ? (
                        <Badge variant="outline" className="ms-2">
                          {t('late')}
                        </Badge>
                      ) : null}
                      {c.cancelledAt ? (
                        <Badge variant="outline" className="ms-2 no-underline">
                          {t('cancelled')}
                        </Badge>
                      ) : null}
                    </td>
                    <td data-label={t('costSupplier')} className="p-3">
                      {c.supplier?.name ?? '—'}
                    </td>
                    <td data-label={t('method')} className="p-3">
                      {t(`method${c.method}`)}
                    </td>
                    <td data-label={t('allocated')} className="num p-3 text-end whitespace-nowrap">
                      <Amount value={c.allocated} />
                      {c.amountCurrency ? (
                        <span className="block text-xs text-muted-foreground" dir="ltr">
                          {c.amountCurrency} {c.currency} × {c.exchangeRate}
                        </span>
                      ) : null}
                    </td>
                    {isOpen ? (
                      <td className="p-3 text-end">
                        {!c.cancelledAt ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t('cancelCost')}
                            onClick={() => setDialog({ cancelCost: c.id })}
                          >
                            <XCircle aria-hidden />
                          </Button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {f.purchases.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('previewSection')}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {isOpen ? t('previewHint') : t('previewHintClosed')}
            </p>
          </CardHeader>
          <CardContent className="space-y-3 px-0 pb-0">
            {p && p.problems.length > 0 ? (
              <div className="px-6">
                <Alert variant="destructive">
                  <AlertDescription>
                    <ul className="list-disc ps-4">
                      {p.problems.map((pr) => {
                        const cost = p.costs.find((c) => c.id === pr.costId);
                        const code =
                          pr.code in ErrorCode ? (pr.code as ErrorCode) : 'INTERNAL_ERROR';
                        return (
                          <li key={`${pr.costId}-${pr.code}`}>
                            {cost ? `${costName(cost)} : ` : ''}
                            {te(code)}
                          </li>
                        );
                      })}
                    </ul>
                  </AlertDescription>
                </Alert>
              </div>
            ) : null}
            {preview.isPending ? (
              <div className="px-6 pb-6">
                <Skeleton className="h-24 w-full" />
              </div>
            ) : p && p.lines.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="stack-table w-full text-sm">
                  <caption className="sr-only">{t('previewSection')}</caption>
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="p-3 text-start font-medium">{t('colProduct')}</th>
                      <th className="p-3 text-end font-medium">{t('colQty')}</th>
                      <th className="p-3 text-end font-medium">{t('colFob')}</th>
                      {p.costs.map((c) => (
                        <th key={c.id} className="p-3 text-end font-medium">
                          {costName(c)}
                        </th>
                      ))}
                      <th className="p-3 text-end font-medium">{t('colLandedUnit')}</th>
                      <th className="p-3 text-end font-medium">{t('colCump')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.lines.map((l) => (
                      <tr key={l.purchaseLineId} className="border-t">
                        <td data-cell="main" className="p-3 font-medium">
                          {l.designation}
                          <span
                            className="block text-xs font-normal text-muted-foreground"
                            dir="ltr"
                          >
                            {l.reference}
                            {l.purchaseNumber ? ` · ${l.purchaseNumber}` : ''}
                          </span>
                        </td>
                        <td data-label={t('colQty')} className="num p-3 text-end whitespace-nowrap">
                          {formatQty(l.qtyBase)} {l.baseUnitCode}
                        </td>
                        <td data-label={t('colFob')} className="num p-3 text-end whitespace-nowrap">
                          <Amount value={l.value} />
                          {l.valueCurrency ? (
                            <span className="block text-xs text-muted-foreground" dir="ltr">
                              {l.valueCurrency} {l.currency}
                            </span>
                          ) : null}
                        </td>
                        {p.costs.map((c, i) => (
                          <td
                            key={c.id}
                            data-label={costName(c)}
                            className="num p-3 text-end whitespace-nowrap"
                          >
                            <Amount value={l.shares[i] ?? '0'} />
                          </td>
                        ))}
                        <td
                          data-label={t('colLandedUnit')}
                          className="num p-3 text-end whitespace-nowrap font-semibold"
                        >
                          {l.landedUnitCost ? <Amount value={l.landedUnitCost} /> : '—'}
                        </td>
                        <td
                          data-label={t('colCump')}
                          className="num p-3 text-end whitespace-nowrap text-muted-foreground"
                        >
                          <Amount value={l.currentCump} />
                          {l.landedUnitCost && !qty(l.currentCump).isZero() ? (
                            <span className="block text-xs" dir="ltr">
                              {qty(l.landedUnitCost).minus(l.currentCump).isNegative() ? '' : '+'}
                              {qty(l.landedUnitCost)
                                .minus(l.currentCump)
                                .div(l.currentCump)
                                .times(100)
                                .toFixed(1)}
                              %
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {isOpen ? (
        <div className="sticky bottom-0 z-20 -mx-4 flex flex-wrap justify-between gap-2 border-t bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:py-3 backdrop-blur lg:-mx-6 lg:px-6">
          <Button variant="ghost" onClick={() => setDialog('cancelFile')}>
            <XCircle aria-hidden />
            {t('cancelFile')}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={!canClose || close.isPending}>
                {close.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Lock aria-hidden />
                )}
                {t('close')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('closeTitle')}</AlertDialogTitle>
                <AlertDialogDescription>{t('closeBody')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{tp('keep')}</AlertDialogCancel>
                <AlertDialogAction onClick={() => close.mutate()}>{t('close')}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : null}

      {dialog === 'edit' ? (
        <ImportFileFormDialog open file={f} onOpenChange={() => setDialog(null)} />
      ) : null}
      {dialog === 'attach' ? (
        <AttachPurchaseDialog open file={f} onOpenChange={() => setDialog(null)} />
      ) : null}
      {dialog === 'cost' || dialog === 'late' ? (
        <ImportCostDialog
          open
          file={f}
          lines={p?.lines ?? []}
          late={dialog === 'late'}
          onOpenChange={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'cancelFile' ? (
        <ReasonDialog
          title={t('cancelFileTitle')}
          path={`/import-files/${id}/cancel`}
          done={t('fileCancelled')}
          onSaved={onSaved}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog && typeof dialog === 'object' ? (
        <ReasonDialog
          title={t('cancelCostTitle')}
          path={`/import-files/${id}/costs/${dialog.cancelCost}/cancel`}
          done={t('costCancelled')}
          onSaved={(saved) => {
            onSaved(saved);
            void queryClient.invalidateQueries({ queryKey: ['suppliers'] });
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

/** Cancelling a cost line or the whole open dossier: a reason is kept in the audit. */
function ReasonDialog({
  title,
  path,
  done,
  onSaved,
  onClose,
}: {
  title: string;
  path: string;
  done: string;
  onSaved: (saved: ImportFileDto) => void;
  onClose: () => void;
}) {
  const t = useTranslations('importFiles');
  const tp = useTranslations('purchases');
  const errorMessage = useErrorMessage();
  const key = useIdempotencyKey(true);
  const [reason, setReason] = useState('');
  const valid = reason.trim().length >= 3;
  const save = useMutation({
    mutationFn: () =>
      api.request<ImportFileDto>(path, {
        method: 'POST',
        idempotencyKey: key,
        body: { reason: reason.trim() },
      }),
    onSuccess: (saved) => {
      onSaved(saved);
      toast.success(done);
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <ResponsiveDialog open onOpenChange={(o) => (o ? null : onClose())}>
      <ResponsiveDialogContent className="md:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !save.isPending) save.mutate();
          }}
        >
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cancel-reason">{t('reason')}</Label>
            <Input
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={255}
            />
          </div>
          <ResponsiveDialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {tp('keep')}
            </Button>
            <Button type="submit" variant="destructive" disabled={!valid || save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t('confirmCancel')}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
