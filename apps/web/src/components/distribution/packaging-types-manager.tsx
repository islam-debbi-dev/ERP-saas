'use client';

import { ArrowLeft, Loader2, PackageOpen, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { formatDA, parseDA, Role } from '@erp/shared';
import { Amount } from '@/components/shared/amount';
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
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import { useAuth } from '@/lib/auth';
import {
  useArchivePackagingType,
  usePackagingTypes,
  useSavePackagingType,
} from '@/lib/distribution';
import { useErrorMessage } from '@/lib/use-error-message';

interface Editing {
  id: string | null;
  name: string;
  deposit: string;
}

/** Produits > Emballages (phase 20, PACKAGING): casiers, palettes, bonbonnes… */
export function PackagingTypesManager() {
  const t = useTranslations('packaging');
  const tp = useTranslations('products');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const { state } = useAuth();
  const writer = state.user?.role === Role.OWNER || state.user?.role === Role.MANAGER;
  const types = usePackagingTypes();
  const save = useSavePackagingType();
  const archive = useArchivePackagingType();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const list = types.data ?? [];
  const depositOk = !editing?.deposit.trim() || parseDA(editing.deposit) !== null;

  const submit = () => {
    if (!editing || !editing.name.trim() || !depositOk) return;
    const deposit = editing.deposit.trim() ? parseDA(editing.deposit) : null;
    save.mutate(
      {
        id: editing.id,
        body: { name: editing.name.trim(), depositValue: deposit ? deposit.toString() : null },
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

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          writer ? (
            <Button onClick={() => setEditing({ id: null, name: '', deposit: '' })}>
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
        {types.isPending ? (
          <div className="space-y-2 p-4" aria-busy>
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : types.isError ? (
          <p role="alert" className="p-4 text-sm text-destructive">
            {errorMessage(types.error)}
          </p>
        ) : list.length === 0 ? (
          <EmptyState icon={PackageOpen} title={t('emptyTitle')} description={t('emptyHelp')} />
        ) : (
          <ul className="divide-y">
            {list.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate font-medium" title={p.name}>
                    {p.name}
                  </p>
                  <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                    <span>{t('productCount', { count: p.productCount })}</span>
                    {p.depositValue ? (
                      <span>
                        {t('deposit')} <Amount value={p.depositValue} />
                      </span>
                    ) : null}
                  </p>
                </div>
                {writer ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11"
                      aria-label={t('editNamed', { name: p.name })}
                      onClick={() =>
                        setEditing({
                          id: p.id,
                          name: p.name,
                          deposit: p.depositValue
                            ? formatDA(p.depositValue, { currency: false })
                            : '',
                        })
                      }
                    >
                      <Pencil aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11"
                      aria-label={t('archiveNamed', { name: p.name })}
                      onClick={() => setRemoving({ id: p.id, name: p.name })}
                    >
                      <Trash2 aria-hidden />
                    </Button>
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
              <Label htmlFor="packaging-name">{t('name')}</Label>
              <Input
                id="packaging-name"
                autoFocus
                required
                minLength={2}
                maxLength={80}
                placeholder={t('namePlaceholder')}
                value={editing?.name ?? ''}
                onChange={(e) =>
                  setEditing((cur) => (cur ? { ...cur, name: e.target.value } : cur))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="packaging-deposit">{t('depositValue')}</Label>
              <Input
                id="packaging-deposit"
                dir="ltr"
                inputMode="decimal"
                className="num"
                aria-invalid={!depositOk}
                value={editing?.deposit ?? ''}
                onChange={(e) =>
                  setEditing((cur) => (cur ? { ...cur, deposit: e.target.value } : cur))
                }
              />
              <p className="text-xs text-muted-foreground">{t('depositHelp')}</p>
            </div>
            <ResponsiveDialogFooter>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                {tc('cancel')}
              </Button>
              <Button type="submit" disabled={save.isPending || !depositOk}>
                {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {tc('save')}
              </Button>
            </ResponsiveDialogFooter>
          </form>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

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
