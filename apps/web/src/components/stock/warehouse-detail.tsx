'use client';

import { ArrowLeft, Loader2, Pencil, Truck, Users, Warehouse } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { type CategoryDto, Feature, Permission, type WarehouseDetailDto } from '@erp/shared';
import { RentBlock } from '@/components/expenses/rent-block';
import { DepotLocationCard } from '@/components/hr/depot-location-card';
import { EmptyState } from '@/components/shared/empty-state';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useFeature, usePermission } from '@/lib/auth';
import { useCategories } from '@/lib/catalog';
import { useBrands } from '@/lib/sales-force';
import { useSaveWarehouse, useSetWarehouseSells, useWarehouseDetail } from '@/lib/stock';
import { useErrorMessage } from '@/lib/use-error-message';
import { useUsers } from '@/lib/users';

/** A dépôt as a business unit (phase 24): what it sells, its manager, team and trucks. */
export function WarehouseDetail({ id }: { id: string }) {
  return (
    <FeatureGate feature={Feature.MULTI_UNIT}>
      <Detail id={id} />
    </FeatureGate>
  );
}

function Detail({ id }: { id: string }) {
  const t = useTranslations('multiUnit');
  const errorMessage = useErrorMessage();
  const detail = useWarehouseDetail(id);
  const writer = usePermission(Permission.SETTINGS_EDIT);
  // Phase 25: the dépôt's rent, next to what it sells (its profit needs it).
  const expensesOn = useFeature(Feature.EXPENSES);
  const canSeeRent = usePermission(Permission.EXPENSES_VIEW);
  const rentOn = expensesOn && canSeeRent;
  const hrOn = useFeature(Feature.HR);
  const [editing, setEditing] = useState<'brands' | 'categories' | null>(null);

  if (detail.isPending) {
    return (
      <div className="space-y-3" aria-busy>
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (detail.isError) {
    return (
      <EmptyState icon={Warehouse} title={t('notFound')} description={errorMessage(detail.error)} />
    );
  }
  const w = detail.data;

  return (
    <div className="space-y-4">
      <PageHeader
        title={w.name}
        description={t('sellsHelp')}
        more={[
          {
            label: t('back'),
            icon: ArrowLeft,
            flipIcon: true,
            tone: 'ghost',
            href: '/stock/depots',
          },
        ]}
      />

      <Card className="space-y-3 p-4">
        <h2 className="font-semibold">{t('sells')}</h2>
        <SellsRow
          label={t('brands')}
          items={w.brands}
          onEdit={writer ? () => setEditing('brands') : undefined}
          editLabel={t('editBrands')}
        />
        <SellsRow
          label={t('categories')}
          items={w.categories}
          onEdit={writer ? () => setEditing('categories') : undefined}
          editLabel={t('editCategories')}
        />
      </Card>

      {rentOn && w.type !== 'VEHICLE' ? <RentBlock warehouseId={w.id} /> : null}

      <ManagerCard warehouse={w} writer={writer} />
      {hrOn && writer && w.type !== 'VEHICLE' ? <DepotLocationCard warehouse={w} /> : null}

      <Card className="p-0">
        <div className="space-y-1 p-4 pb-2">
          <h2 className="font-semibold">{t('team')}</h2>
          <p className="text-xs text-muted-foreground">{t('teamHelp')}</p>
        </div>
        {w.team.length === 0 ? (
          <EmptyState icon={Users} title={t('teamEmpty')} />
        ) : (
          <TeamList team={w.team} />
        )}
      </Card>

      <Card className="p-0">
        <h2 className="p-4 pb-2 font-semibold">{t('trucks')}</h2>
        {w.trucks.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground">{t('trucksEmpty')}</p>
        ) : (
          <ul className="divide-y">
            {w.trucks.map((truck) => (
              <li key={truck.id} className="flex min-h-11 items-center gap-3 px-4 py-2">
                <Truck className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-medium" title={truck.name}>
                  {truck.name}
                </span>
                <span className="truncate text-sm text-muted-foreground">
                  {truck.assignedUser?.fullName ?? t('noDriver')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editing ? (
        <SellsDialog warehouse={w} kind={editing} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

function SellsRow({
  label,
  items,
  onEdit,
  editLabel,
}: {
  label: string;
  items: { id: string; name: string }[];
  onEdit?: () => void;
  editLabel: string;
}) {
  const t = useTranslations('multiUnit');
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-1.5">
        <p className="text-sm font-medium">{label}</p>
        <div className="flex flex-wrap gap-1.5">
          {items.length === 0 ? (
            <span className="text-sm text-muted-foreground">{t('sellsAll')}</span>
          ) : (
            items.map((i) => (
              <Badge key={i.id} variant="secondary" className="max-w-full truncate">
                {i.name}
              </Badge>
            ))
          )}
        </div>
      </div>
      {onEdit ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-11 shrink-0"
          aria-label={editLabel}
          onClick={onEdit}
        >
          <Pencil aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}

function TeamList({ team }: { team: WarehouseDetailDto['team'] }) {
  const t = useTranslations('multiUnit');
  const tr = useTranslations('roles');
  return (
    <ul className="divide-y">
      {team.map((m) => (
        <li key={m.id} className="flex min-h-11 items-center gap-3 px-4 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium" title={m.fullName}>
              {m.fullName}
            </p>
            <p className="text-xs text-muted-foreground">{tr(m.role)}</p>
          </div>
          <Badge variant={m.level === 'OPERATE' ? 'default' : 'outline'} className="shrink-0">
            {t(`level${m.level}`)}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

function ManagerCard({ warehouse, writer }: { warehouse: WarehouseDetailDto; writer: boolean }) {
  const t = useTranslations('multiUnit');
  const errorMessage = useErrorMessage();
  const canListUsers = usePermission(Permission.USERS_VIEW);
  const users = useUsers(writer && canListUsers);
  const save = useSaveWarehouse();
  const choices = (users.data ?? []).filter((u) => u.active);

  return (
    <Card className="space-y-2 p-4">
      <Label htmlFor="warehouse-manager" className="font-semibold">
        {t('manager')}
      </Label>
      {writer && canListUsers ? (
        <div className="flex items-center gap-2">
          <NativeSelect
            id="warehouse-manager"
            className="md:max-w-sm"
            value={warehouse.manager?.id ?? ''}
            disabled={save.isPending || users.isPending}
            onChange={(e) =>
              save.mutate(
                { id: warehouse.id, body: { managerUserId: e.target.value || null } },
                {
                  onSuccess: () => toast.success(t('saved')),
                  onError: (err) => toast.error(errorMessage(err)),
                },
              )
            }
          >
            <option value="">{t('noManager')}</option>
            {choices.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
          </NativeSelect>
          {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        </div>
      ) : (
        <p id="warehouse-manager" className="text-sm">
          {warehouse.manager?.fullName ?? t('noManager')}
        </p>
      )}
    </Card>
  );
}

/** Flattens the category tree with its depth, for an indented list. */
function flatten(nodes: CategoryDto[], depth = 0): { id: string; name: string; depth: number }[] {
  return nodes.flatMap((n) => [
    { id: n.id, name: n.name, depth },
    ...flatten(n.children, depth + 1),
  ]);
}

function SellsDialog({
  warehouse,
  kind,
  onClose,
}: {
  warehouse: WarehouseDetailDto;
  kind: 'brands' | 'categories';
  onClose: () => void;
}) {
  const t = useTranslations('multiUnit');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const brands = useBrands();
  const categories = useCategories();
  const save = useSetWarehouseSells();
  const current = kind === 'brands' ? warehouse.brands : warehouse.categories;
  const [picked, setPicked] = useState<Set<string>>(new Set(current.map((c) => c.id)));
  const options =
    kind === 'brands'
      ? (brands.data ?? []).map((b) => ({ id: b.id, name: b.name, depth: 0 }))
      : flatten(categories.data ?? []);
  const loading = kind === 'brands' ? brands.isPending : categories.isPending;

  const submit = () => {
    const ids = [...picked];
    save.mutate(
      {
        id: warehouse.id,
        body: kind === 'brands' ? { brandIds: ids } : { categoryIds: ids },
      },
      {
        onSuccess: () => {
          toast.success(t('saved'));
          onClose();
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent className="md:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {kind === 'brands' ? t('editBrands') : t('editCategories')}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{t('sellsHelp')}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {loading ? (
          <Skeleton className="h-32 w-full" />
        ) : options.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {kind === 'brands' ? t('noBrandsYet') : t('noCategoriesYet')}
          </p>
        ) : (
          <ul className="max-h-[50dvh] divide-y overflow-y-auto rounded-md border">
            {options.map((o) => (
              <li key={o.id}>
                <label
                  className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2"
                  style={{ paddingInlineStart: `${0.75 + o.depth}rem` }}
                >
                  <input
                    type="checkbox"
                    className="size-5 shrink-0 accent-primary"
                    checked={picked.has(o.id)}
                    onChange={(e) =>
                      setPicked((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(o.id);
                        else next.delete(o.id);
                        return next;
                      })
                    }
                  />
                  <span className="min-w-0 truncate">{o.name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button onClick={submit} disabled={save.isPending || loading}>
            {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {tc('save')}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
