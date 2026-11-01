'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Archive, Loader2, Pencil, Plus, Truck } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { CURRENCIES, Feature, type SupplierDto } from '@erp/shared';
import { NativeSelect } from '@/components/ui/native-select';
import { useFeature } from '@/lib/auth';
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { api } from '@/lib/api-client';
import { useCanManageCredit } from '@/lib/clients';
import { useSuppliers } from '@/lib/purchases';
import { useErrorMessage } from '@/lib/use-error-message';
import { SupplierBalance } from './supplier-balance';

type Fields = Record<
  'name' | 'code' | 'phone' | 'address' | 'rc' | 'nif' | 'nis' | 'ai' | 'notes',
  string
>;
const EMPTY: Fields = {
  name: '',
  code: '',
  phone: '',
  address: '',
  rc: '',
  nif: '',
  nis: '',
  ai: '',
  notes: '',
};
const LTR_FIELDS = new Set(['code', 'phone', 'rc', 'nif', 'nis', 'ai']);

export function SuppliersManager() {
  const t = useTranslations('suppliers');
  const tp = useTranslations('purchases');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const canManage = useCanManageCredit();
  const [search, setSearch] = useState('');
  const suppliers = useSuppliers(useDebouncedValue(search.trim(), 300));
  const importOn = useFeature(Feature.IMPORT_COSTS);
  const [editing, setEditing] = useState<{
    id: string | null;
    fields: Fields;
    /** Phase 22: the currency of its BRs and account; fixed once it has entries. */
    currency: string;
  } | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['suppliers'] });
  const save = useMutation({
    mutationFn: (e: { id: string | null; fields: Fields; currency: string }) =>
      api.request<SupplierDto>(e.id ? `/suppliers/${e.id}` : '/suppliers', {
        method: e.id ? 'PATCH' : 'POST',
        body: { ...e.fields, ...(importOn ? { currency: e.currency } : {}) },
      }),
    onSuccess: (_s, e) => {
      void refresh();
      setEditing(null);
      toast.success(e.id ? t('saved') : t('created'));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const archive = useMutation({
    mutationFn: (id: string) => api.request<void>(`/suppliers/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void refresh();
      toast.success(t('archived'));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const items = suppliers.data?.items ?? [];
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <>
            <Button asChild variant="ghost">
              <Link href="/achats">
                <ArrowLeft className="rtl-flip" aria-hidden />
                {tp('back')}
              </Link>
            </Button>
            <Button onClick={() => setEditing({ id: null, fields: EMPTY, currency: 'DZD' })}>
              <Plus aria-hidden />
              {t('new')}
            </Button>
          </>
        }
      />
      <Input
        type="search"
        aria-label={t('searchLabel')}
        placeholder={t('searchLabel')}
        className="sm:max-w-md"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <Card className="p-0">
        {suppliers.isPending ? (
          <div className="space-y-2 p-4" aria-busy>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={Truck} title={t('emptyTitle')} description={t('emptyDescription')} />
        ) : (
          <ul className="divide-y">
            {items.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <Link
                  href={`/achats/fournisseurs/${s.id}`}
                  className="min-w-0 flex-1 rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <p className="truncate font-medium">{s.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[s.code, s.phone, s.address].filter(Boolean).join(' · ')}
                  </p>
                </Link>
                <div className="flex shrink-0 items-center gap-1">
                  {canManage ? (
                    <SupplierBalance value={s.balance} showHint={false} className="me-1 text-sm" />
                  ) : null}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${t('edit')} ${s.name}`}
                    onClick={() =>
                      setEditing({
                        id: s.id,
                        fields: Object.fromEntries(
                          (Object.keys(EMPTY) as (keyof Fields)[]).map((k) => [k, s[k] ?? '']),
                        ) as Fields,
                        currency: s.currency,
                      })
                    }
                  >
                    <Pencil aria-hidden />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`${t('archive')} ${s.name}`}>
                        <Archive aria-hidden />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t('archiveTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>{t('archiveBody')}</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{tp('keep')}</AlertDialogCancel>
                        <AlertDialogAction onClick={() => archive.mutate(s.id)}>
                          {t('archive')}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ResponsiveDialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <ResponsiveDialogContent className="md:max-w-xl">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (editing?.fields.name.trim()) save.mutate(editing);
            }}
          >
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>{editing?.id ? t('edit') : t('new')}</ResponsiveDialogTitle>
            </ResponsiveDialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              {(Object.keys(EMPTY) as (keyof Fields)[]).map((k) => (
                <div
                  key={k}
                  className={
                    k === 'address' || k === 'notes' ? 'space-y-2 sm:col-span-2' : 'space-y-2'
                  }
                >
                  <Label htmlFor={`supplier-${k}`}>{t(k)}</Label>
                  <Input
                    id={`supplier-${k}`}
                    type={k === 'phone' ? 'tel' : undefined}
                    inputMode={k === 'phone' ? 'tel' : undefined}
                    dir={LTR_FIELDS.has(k) ? 'ltr' : undefined}
                    autoFocus={k === 'name'}
                    required={k === 'name'}
                    value={editing?.fields[k] ?? ''}
                    onChange={(e) =>
                      setEditing((cur) =>
                        cur ? { ...cur, fields: { ...cur.fields, [k]: e.target.value } } : cur,
                      )
                    }
                  />
                </div>
              ))}
              {importOn ? (
                <div className="space-y-2">
                  <Label htmlFor="supplier-currency">{t('currency')}</Label>
                  <NativeSelect
                    id="supplier-currency"
                    aria-describedby="supplier-currency-hint"
                    value={editing?.currency ?? 'DZD'}
                    onChange={(e) =>
                      setEditing((cur) => (cur ? { ...cur, currency: e.target.value } : cur))
                    }
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </NativeSelect>
                  <p id="supplier-currency-hint" className="text-xs text-muted-foreground">
                    {t('currencyHint')}
                  </p>
                </div>
              ) : null}
            </div>
            <ResponsiveDialogFooter>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                {tp('cancel')}
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {tc('save')}
              </Button>
            </ResponsiveDialogFooter>
          </form>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
