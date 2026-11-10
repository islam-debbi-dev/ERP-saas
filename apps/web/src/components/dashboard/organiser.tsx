'use client';

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, Loader2, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  type DashboardCardId,
  type DashboardLayout,
  defaultDashboardLayout,
  Role,
} from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/lib/auth';
import { useSaveDashboardLayout } from '@/lib/dashboard-layout';
import { useErrorMessage } from '@/lib/use-error-message';
import { cn } from '@/lib/utils';

/**
 * "Organiser" (phase 33.5): move cards with the handle (mouse, touch on the handle only,
 * or the keyboard: space then arrows), or with the up / down buttons on a phone where a
 * long press would fight the scroll; the eye hides or shows a card.
 */
export function Organiser({
  layout,
  available,
  onClose,
}: {
  layout: DashboardLayout;
  /** The cards this user can have; the others keep their place unseen. */
  available: readonly DashboardCardId[];
  onClose: () => void;
}) {
  const t = useTranslations('dashboard');
  const errorMessage = useErrorMessage();
  const role = useAuth().state.user?.role ?? Role.SELLER;
  const save = useSaveDashboardLayout();
  const [order, setOrder] = useState(layout.order);
  const [hidden, setHidden] = useState(new Set(layout.hidden));
  const rows = order.filter((id) => available.includes(id));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const move = (id: DashboardCardId, to: DashboardCardId) =>
    setOrder((o) => arrayMove(o, o.indexOf(id), o.indexOf(to)));
  const step = (id: DashboardCardId, delta: -1 | 1) => {
    const neighbour = rows[rows.indexOf(id) + delta];
    if (neighbour) move(id, neighbour);
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (e.over && e.active.id !== e.over.id)
      move(e.active.id as DashboardCardId, e.over.id as DashboardCardId);
  };
  const toggle = (id: DashboardCardId) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const reset = () => {
    const d = defaultDashboardLayout(role);
    setOrder(d.order);
    setHidden(new Set(d.hidden));
  };
  const submit = () =>
    save.mutate(
      { order, hidden: [...hidden] },
      {
        onSuccess: () => {
          toast.success(t('organiseSaved'));
          onClose();
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );

  return (
    <Card className="gap-3 py-4" data-testid="organiser">
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="text-base">
          {t('organiseTitle')}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t('organiseHint')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={rows} strategy={verticalListSortingStrategy}>
            <ol className="divide-y rounded-md border">
              {rows.map((id, n) => (
                <Row
                  key={id}
                  id={id}
                  hidden={hidden.has(id)}
                  first={n === 0}
                  last={n === rows.length - 1}
                  onUp={() => step(id, -1)}
                  onDown={() => step(id, 1)}
                  onToggle={() => toggle(id)}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" onClick={reset}>
            <RotateCcw aria-hidden />
            {t('organiseReset')}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              {t('periodCancel')}
            </Button>
            <Button onClick={submit} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t('organiseSave')}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Row({
  id,
  hidden,
  first,
  last,
  onUp,
  onDown,
  onToggle,
}: {
  id: DashboardCardId;
  hidden: boolean;
  first: boolean;
  last: boolean;
  onUp: () => void;
  onDown: () => void;
  onToggle: () => void;
}) {
  const t = useTranslations('dashboard');
  const name = t(`card_${id}`);
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-1 bg-card px-1 py-1',
        isDragging && 'relative z-10 shadow-md',
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={t('organiseMove', { name })}
        className="hidden size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:flex"
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <span
        className={cn(
          'min-w-0 flex-1 truncate ps-2 text-sm',
          hidden && 'text-muted-foreground line-through',
        )}
      >
        {name}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-11 md:hidden"
        aria-label={t('organiseUp', { name })}
        disabled={first}
        onClick={onUp}
      >
        <ArrowUp aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-11 md:hidden"
        aria-label={t('organiseDown', { name })}
        disabled={last}
        onClick={onDown}
      >
        <ArrowDown aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-11"
        aria-label={t(hidden ? 'organiseShow' : 'organiseHide', { name })}
        aria-pressed={!hidden}
        onClick={onToggle}
      >
        {hidden ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
      </Button>
    </li>
  );
}
