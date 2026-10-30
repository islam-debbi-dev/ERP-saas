'use client';

import { BadgePercent, Gift, MoreVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { type PromotionDto, type PromotionStatus, PROMOTION_STATUSES, Role } from '@erp/shared';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth';
import { usePriceLevels } from '@/lib/catalog';
import { useArchivePromotion, usePromotions } from '@/lib/distribution';
import { useBrands, useSectors } from '@/lib/sales-force';
import { formatQty } from '@/lib/stock';
import { useErrorMessage } from '@/lib/use-error-message';
import { cn } from '@/lib/utils';
import { PromotionDialog } from './promotion-dialog';

/** Promotions (phase 20): running, coming and ended; managers create and edit them. */
export function PromotionsPage() {
  const t = useTranslations('promotions');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const { state } = useAuth();
  const writer = state.user?.role === Role.OWNER || state.user?.role === Role.MANAGER;
  const [status, setStatus] = useState<PromotionStatus>('active');
  const list = usePromotions(status);
  const archive = useArchivePromotion();
  const [dialog, setDialog] = useState<{ editing: PromotionDto | null } | null>(null);
  const [removing, setRemoving] = useState<PromotionDto | null>(null);
  const items = list.data ?? [];

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          writer ? (
            <Button onClick={() => setDialog({ editing: null })}>
              <Plus aria-hidden />
              {t('new')}
            </Button>
          ) : undefined
        }
      />

      <div role="tablist" aria-label={t('statusFilter')} className="flex gap-2 overflow-x-auto">
        {PROMOTION_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={status === s}
            onClick={() => setStatus(s)}
            className={cn(
              'min-h-11 shrink-0 rounded-full border px-4 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              status === s
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-background hover:bg-muted',
            )}
          >
            {t(`status${s}`)}
          </button>
        ))}
      </div>

      <Card className="p-0">
        {list.isPending ? (
          <div className="space-y-2 p-4" aria-busy>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : list.isError ? (
          <p role="alert" className="p-4 text-sm text-destructive">
            {errorMessage(list.error)}
          </p>
        ) : items.length === 0 ? (
          <EmptyState
            icon={BadgePercent}
            title={t(`empty${status}`)}
            description={writer ? t('emptyHelp') : undefined}
          />
        ) : (
          <ul className="divide-y">
            {items.map((p) => (
              <li key={p.id} className="flex items-start gap-3 px-4 py-3">
                <span
                  aria-hidden
                  className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
                >
                  {p.type === 'FREE_UNITS' ? (
                    <Gift className="size-4" />
                  ) : (
                    <BadgePercent className="size-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium" title={p.name}>
                      {p.name}
                    </p>
                    {p.priority > 0 ? (
                      <Badge variant="outline">{t('priorityBadge', { n: p.priority })}</Badge>
                    ) : null}
                    {!p.active ? <Badge variant="secondary">{t('inactive')}</Badge> : null}
                  </div>
                  <PromotionRule p={p} />
                  <PromotionMeta p={p} />
                </div>
                {writer ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11 shrink-0"
                        aria-label={t('actionsOf', { name: p.name })}
                      >
                        <MoreVertical aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        className="min-h-11"
                        onSelect={() => setDialog({ editing: p })}
                      >
                        <Pencil aria-hidden />
                        {t('edit')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="min-h-11"
                        variant="destructive"
                        onSelect={() => setRemoving(p)}
                      >
                        <Trash2 aria-hidden />
                        {t('archive')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <PromotionDialog
        key={dialog ? (dialog.editing?.id ?? 'new') : 'closed'}
        open={dialog !== null}
        onOpenChange={(o) => !o && setDialog(null)}
        editing={dialog?.editing ?? null}
      />

      <AlertDialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('archiveTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('archiveBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                removing &&
                archive.mutate(removing.id, {
                  onSuccess: () => toast.success(t('archived')),
                  onError: (err) => toast.error(errorMessage(err)),
                })
              }
            >
              {t('archive')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** "10 → 1 free", "−5 % on brand X". */
function PromotionRule({ p }: { p: PromotionDto }) {
  const t = useTranslations('promotions');
  const brands = useBrands();
  if (p.type === 'FREE_UNITS') {
    const product = p.buyProduct?.designation ?? '';
    const free = p.freeProduct?.designation ?? product;
    return (
      <p className="text-sm">
        {t('ruleFreeUnits', {
          buy: formatQty(p.buyQty ?? '0'),
          product,
          free: formatQty(p.freeQty ?? '0'),
          freeProduct: free,
        })}
        {p.repeatable ? ` · ${t('repeatableShort')}` : ''}
      </p>
    );
  }
  const target =
    p.target === 'BRAND'
      ? (brands.data?.find((b) => b.id === p.brandId)?.name ?? t('targetBRAND'))
      : p.target === 'CATEGORY'
        ? t('targetCATEGORY')
        : p.products.map((x) => x.designation).join(', ');
  return (
    <p className="text-sm">
      {t('rulePercent', { pct: Number(p.discountPct ?? '0'), target })}
      {p.minQtyBase ? ` · ${t('ruleMin', { qty: formatQty(p.minQtyBase) })}` : ''}
    </p>
  );
}

function PromotionMeta({ p }: { p: PromotionDto }) {
  const t = useTranslations('promotions');
  const format = useFormatter();
  const levels = usePriceLevels();
  const sectors = useSectors();
  const day = (iso: string) =>
    format.dateTime(new Date(`${iso}T12:00:00Z`), { dateStyle: 'medium' });
  const scope =
    p.clientScope === 'PRICE_LEVEL'
      ? (levels.data?.find((l) => l.id === p.priceLevelId)?.name ?? t('scopePRICE_LEVEL'))
      : p.clientScope === 'SECTOR'
        ? (sectors.data?.find((s) => s.id === p.sectorId)?.name ?? t('scopeSECTOR'))
        : p.clientScope === 'CLIENTS'
          ? t('clientCount', { count: p.clients.length })
          : t('scopeALL');
  return (
    <p className="text-xs text-muted-foreground">
      {t('dates', { from: day(p.validFrom), to: day(p.validTo) })} · {scope}
    </p>
  );
}
