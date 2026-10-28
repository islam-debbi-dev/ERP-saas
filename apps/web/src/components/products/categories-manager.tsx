'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FolderTree, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import type { CategoryDto } from '@erp/shared';
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
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { catalogKeys, useCategories } from '@/lib/catalog';
import { useErrorMessage } from '@/lib/use-error-message';

interface Editing {
  id: string | null;
  name: string;
  parentId: string;
}

export function CategoriesManager() {
  const t = useTranslations('categories');
  const tp = useTranslations('products');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const categories = useCategories();
  const [editing, setEditing] = useState<Editing | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: catalogKeys.categories });

  const save = useMutation({
    mutationFn: (e: Editing) =>
      api.request<CategoryDto>(e.id ? `/categories/${e.id}` : '/categories', {
        method: e.id ? 'PATCH' : 'POST',
        body: { name: e.name, parentId: e.parentId || null },
      }),
    onSuccess: (_saved, e) => {
      void refresh();
      setEditing(null);
      toast.success(e.id ? t('saved') : t('created'));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.request<void>(`/categories/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void refresh();
      toast.success(t('deleted'));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const tops = categories.data ?? [];

  function row(c: CategoryDto, depth: 0 | 1) {
    return (
      <li key={c.id} className={depth === 1 ? 'ps-8' : undefined}>
        <div className="flex items-center justify-between gap-2 px-4 py-2.5">
          <div className="min-w-0">
            <p className={depth === 0 ? 'font-medium' : undefined}>{c.name}</p>
            {depth === 0 && c.children.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('subcount', { count: c.children.length })}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {depth === 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing({ id: null, name: '', parentId: c.id })}
              >
                <Plus aria-hidden />
                <span className="hidden sm:inline">{t('addSub')}</span>
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              aria-label={`${t('edit')} ${c.name}`}
              onClick={() => setEditing({ id: c.id, name: c.name, parentId: c.parentId ?? '' })}
            >
              <Pencil aria-hidden />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={`${t('delete')} ${c.name}`}>
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
                  <AlertDialogAction onClick={() => remove.mutate(c.id)}>
                    {t('delete')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
        {depth === 0 && c.children.length > 0 ? (
          <ul className="divide-y border-t">{c.children.map((child) => row(child, 1))}</ul>
        ) : null}
      </li>
    );
  }

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <>
            <Button asChild variant="ghost">
              <Link href="/produits">
                <ArrowLeft className="rtl-flip" aria-hidden />
                {tp('back')}
              </Link>
            </Button>
            <Button onClick={() => setEditing({ id: null, name: '', parentId: '' })}>
              <Plus aria-hidden />
              {t('new')}
            </Button>
          </>
        }
      />

      <Card className="p-0">
        {categories.isPending ? (
          <div className="space-y-2 p-4" aria-busy>
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : tops.length === 0 ? (
          <EmptyState
            icon={FolderTree}
            title={t('emptyTitle')}
            description={t('emptyDescription')}
          />
        ) : (
          <ul className="divide-y">{tops.map((c) => row(c, 0))}</ul>
        )}
      </Card>

      <ResponsiveDialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <ResponsiveDialogContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (editing && editing.name.trim())
                save.mutate({ ...editing, name: editing.name.trim() });
            }}
          >
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>{editing?.id ? t('edit') : t('new')}</ResponsiveDialogTitle>
            </ResponsiveDialogHeader>
            <div className="space-y-2">
              <Label htmlFor="category-name">{t('name')}</Label>
              <Input
                id="category-name"
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
              <Label htmlFor="category-parent">{t('parent')}</Label>
              <NativeSelect
                id="category-parent"
                value={editing?.parentId ?? ''}
                onChange={(e) =>
                  setEditing((cur) => (cur ? { ...cur, parentId: e.target.value } : cur))
                }
              >
                <option value="">{t('none')}</option>
                {tops
                  .filter((c) => c.id !== editing?.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
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
