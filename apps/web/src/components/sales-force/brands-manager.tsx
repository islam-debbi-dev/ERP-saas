'use client';

import { ArrowLeft, Loader2, Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Role } from '@erp/shared';
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
import { useAuth } from '@/lib/auth';
import { useSuppliers } from '@/lib/purchases';
import { useBrands, useDeleteBrand, useSaveBrand } from '@/lib/sales-force';
import { useErrorMessage } from '@/lib/use-error-message';

interface Editing {
  id: string | null;
  name: string;
  supplierId: string;
}

/** Produits > Marques (phase 14, every plan). */
export function BrandsManager() {
  const t = useTranslations('brands');
  const tp = useTranslations('products');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const { state } = useAuth();
  const writer = state.user?.role === Role.OWNER || state.user?.role === Role.MANAGER;
  const brands = useBrands();
  const [editing, setEditing] = useState<Editing | null>(null);
  const suppliers = useSuppliers('', editing !== null);
  const save = useSaveBrand();
  const remove = useDeleteBrand();

  const submit = () => {
    if (!editing || !editing.name.trim()) return;
    save.mutate(
      {
        id: editing.id,
        body: { name: editing.name.trim(), supplierId: editing.supplierId || null },
      },
      {
        onSuccess: () => {
          toast.success(editing.id ? t('saved') : t('created'));
          setEditing(null);
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  const list = brands.data ?? [];

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          writer ? (
            <Button onClick={() => setEditing({ id: null, name: '', supplierId: '' })}>
              <Plus aria-hidden />
              {t('new')}
            </Button>
          ) : undefined
        }
        more={[
          { label: tp('back'), icon: ArrowLeft, flipIcon: true, tone: 'ghost', href: '/produits' },
        ]}
      />

      <Card className="p-0">
        {brands.isPending ? (
          <div className="space-y-2 p-4" aria-busy>
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : brands.isError ? (
          <p role="alert" className="p-4 text-sm text-destructive">
            {errorMessage(brands.error)}
          </p>
        ) : list.length === 0 ? (
          <EmptyState icon={Tag} title={t('emptyTitle')} description={t('emptyDescription')} />
        ) : (
          <ul className="divide-y">
            {list.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate font-medium" title={b.name}>
                    {b.name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t('productCount', { count: b.productCount })}
                    {b.supplierName ? ` · ${b.supplierName}` : ''}
                  </p>
                </div>
                {writer ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11"
                      aria-label={t('editNamed', { name: b.name })}
                      onClick={() =>
                        setEditing({ id: b.id, name: b.name, supplierId: b.supplierId ?? '' })
                      }
                    >
                      <Pencil aria-hidden />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-11"
                          aria-label={t('deleteNamed', { name: b.name })}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
                          <AlertDialogDescription>{t('deleteBody')}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{tp('cancel')}</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() =>
                              remove.mutate(b.id, {
                                onSuccess: () => toast.success(t('deleted')),
                                onError: (err) => toast.error(errorMessage(err)),
                              })
                            }
                          >
                            {t('delete')}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ResponsiveDialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <ResponsiveDialogContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>{editing?.id ? t('edit') : t('new')}</ResponsiveDialogTitle>
            </ResponsiveDialogHeader>
            <div className="space-y-2">
              <Label htmlFor="brand-name">{t('name')}</Label>
              <Input
                id="brand-name"
                autoFocus
                required
                maxLength={80}
                value={editing?.name ?? ''}
                onChange={(e) =>
                  setEditing((cur) => (cur ? { ...cur, name: e.target.value } : cur))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="brand-supplier">{t('supplier')}</Label>
              <NativeSelect
                id="brand-supplier"
                value={editing?.supplierId ?? ''}
                onChange={(e) =>
                  setEditing((cur) => (cur ? { ...cur, supplierId: e.target.value } : cur))
                }
              >
                <option value="">{t('noSupplier')}</option>
                {(suppliers.data?.items ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
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
