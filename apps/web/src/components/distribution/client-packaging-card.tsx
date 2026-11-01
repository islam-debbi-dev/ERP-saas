'use client';

import { Loader2, PackageOpen, Undo2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { type ClientDto, Feature, type PackagingEntryType, Role } from '@erp/shared';
import { PrintButton } from '@/components/shared/print-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useAuth, useFeature } from '@/lib/auth';
import { useClientPackaging, usePackagingMovement, usePackagingTypes } from '@/lib/distribution';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';
import { useErrorMessage } from '@/lib/use-error-message';
import { cn } from '@/lib/utils';

/**
 * Emballages chez le client (phase 20): his count per packaging, the entries (newest
 * first), the relevé PDF, and empties brought back. Readable when the module is off.
 */
export function ClientPackagingCard({ client }: { client: ClientDto }) {
  const t = useTranslations('packaging');
  const format = useFormatter();
  const on = useFeature(Feature.PACKAGING);
  const data = useClientPackaging(client.id);
  const [open, setOpen] = useState(false);
  const pages = data.data?.pages ?? [];
  const balances = pages[0]?.balances ?? [];
  const entries = pages.flatMap((p) => p.entries);
  // Without the module and without history, nothing to show.
  if (!on && data.isSuccess && balances.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle role="heading" aria-level={2} className="flex items-center gap-2">
          <PackageOpen className="size-5" aria-hidden />
          {t('clientTitle')}
        </CardTitle>
        <div className="flex flex-wrap gap-2">
          {entries.length > 0 ? (
            <PrintButton
              path={`/clients/${client.id}/packaging/pdf`}
              fileName={`emballages-${client.code}.pdf`}
            />
          ) : null}
          {on && client.archivedAt === null ? (
            <Button className="min-h-11" onClick={() => setOpen(true)}>
              <Undo2 aria-hidden />
              {t('newMovement')}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.isPending ? (
          <Skeleton className="h-16 w-full" aria-busy />
        ) : balances.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('clientEmpty')}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {balances.map((b) => (
              <li key={b.packagingTypeId} className="rounded-lg border p-3">
                <p className="truncate text-sm text-muted-foreground" title={b.name}>
                  {b.name}
                </p>
                <p
                  dir="ltr"
                  className={cn(
                    'num text-2xl font-semibold rtl:text-end',
                    b.balance < 0 && 'text-destructive',
                  )}
                >
                  {b.balance}
                </p>
              </li>
            ))}
          </ul>
        )}
        {entries.length > 0 ? (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">{t('history')}</h3>
            <ul className="divide-y rounded-lg border text-sm">
              {entries.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate">
                      {t(`entry${e.type}`)} · {e.packagingName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {format.dateTime(new Date(e.createdAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}{' '}
                      · {e.label}
                      {e.note ? ` · ${e.note}` : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-end">
                    <p dir="ltr" className="num font-medium">
                      {e.qty > 0 ? `+${e.qty}` : e.qty}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t('after', { count: e.balanceAfter })}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            {data.hasNextPage ? (
              <Button
                variant="outline"
                className="min-h-11 w-full"
                disabled={data.isFetchingNextPage}
                onClick={() => void data.fetchNextPage()}
              >
                {t('loadMore')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
      <PackagingMovementDialog client={client} open={open} onOpenChange={setOpen} />
    </Card>
  );
}

function PackagingMovementDialog({
  client,
  open,
  onOpenChange,
}: {
  client: ClientDto;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations('packaging');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const { state } = useAuth();
  const manager = state.user?.role === Role.OWNER || state.user?.role === Role.MANAGER;
  const types = usePackagingTypes(open);
  const move = usePackagingMovement();
  const key = useIdempotencyKey(open);
  const [type, setType] = useState<Extract<PackagingEntryType, 'RETURN' | 'ADJUST'>>('RETURN');
  const [packagingTypeId, setPackagingTypeId] = useState('');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const n = Number(qty);
  const valid =
    packagingTypeId !== '' &&
    /^-?\d+$/.test(qty) &&
    n !== 0 &&
    (type === 'ADJUST' ? note.trim() !== '' : n > 0);

  const close = () => {
    onOpenChange(false);
    setQty('');
    setNote('');
    setType('RETURN');
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : close())}>
      <ResponsiveDialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            move.mutate(
              {
                key,
                body: {
                  clientId: client.id,
                  packagingTypeId,
                  type,
                  qty: n,
                  note: note.trim() || null,
                },
              },
              {
                onSuccess: (res) => {
                  toast.success(t('movementSaved', { count: res.balance }));
                  if (res.negative) toast.warning(t('negativeWarning'));
                  close();
                },
                onError: (err) => toast.error(errorMessage(err)),
              },
            );
          }}
        >
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t('newMovement')}</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          {manager ? (
            <div className="space-y-1">
              <Label htmlFor="pm-type">{t('movementType')}</Label>
              <NativeSelect
                id="pm-type"
                value={type}
                onChange={(e) => setType(e.target.value as 'RETURN' | 'ADJUST')}
              >
                <option value="RETURN">{t('entryRETURN')}</option>
                <option value="ADJUST">{t('entryADJUST')}</option>
              </NativeSelect>
            </div>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="pm-packaging">{t('type')}</Label>
            <NativeSelect
              id="pm-packaging"
              required
              value={packagingTypeId}
              onChange={(e) => setPackagingTypeId(e.target.value)}
            >
              <option value="">{t('pickType')}</option>
              {(types.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="pm-qty">{type === 'RETURN' ? t('qtyReturned') : t('qtyAdjust')}</Label>
            <Input
              id="pm-qty"
              dir="ltr"
              inputMode={type === 'ADJUST' ? 'text' : 'numeric'}
              className="num"
              required
              aria-invalid={qty !== '' && !valid}
              value={qty}
              onChange={(e) => setQty(e.target.value.replace(/[^\d-]/g, ''))}
            />
            {type === 'ADJUST' ? (
              <p className="text-xs text-muted-foreground">{t('adjustHelp')}</p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="pm-note">{type === 'ADJUST' ? t('noteRequired') : t('note')}</Label>
            <Textarea
              id="pm-note"
              maxLength={255}
              required={type === 'ADJUST'}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <ResponsiveDialogFooter>
            <Button type="button" variant="ghost" onClick={close}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={!valid || move.isPending}>
              {move.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {tc('save')}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
