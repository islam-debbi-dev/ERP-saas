'use client';

import {
  Banknote,
  CircleCheck,
  ClipboardCheck,
  Clock,
  FileClock,
  type LucideIcon,
  PackageX,
  ShieldAlert,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type TouchEvent, useRef, useState } from 'react';
import { type TodoItem, type TodoType } from '@erp/shared';
import { useCanOpen } from '@/components/layout/use-visible-nav';
import { Amount } from '@/components/shared/amount';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { todoAction, useVisibleTodo } from '@/lib/todo';
import { useErrorMessage } from '@/lib/use-error-message';
import { cn, isolateAuto } from '@/lib/utils';

const ICONS: Record<TodoType, LucideIcon> = {
  CHEQUE_DUE: Banknote,
  CLIENT_OVER_LIMIT: ShieldAlert,
  SUPPLIER_CHEQUE_DUE: Wallet,
  CLIENT_LATE: Clock,
  OUT_OF_STOCK_SOLD: PackageX,
  ORDER_TO_CONFIRM: ClipboardCheck,
  DRAFT_OLD: FileClock,
};

/** Money first in amber, the rest calm: the colour is a hint, the icon and text say it. */
const URGENT: ReadonlySet<TodoType> = new Set(['CHEQUE_DUE', 'CLIENT_OVER_LIMIT']);

/** How far a finger must slide a row to put it off until tomorrow. */
const SWIPE_PX = 80;

/**
 * "À faire aujourd'hui" (phase 33): the few things that need the user now, most urgent
 * first, each with one button that opens the right screen already filled. Writes nothing.
 */
export function TodoCard() {
  const t = useTranslations('dashboard');
  const errorMessage = useErrorMessage();
  const { query, all, shown, later } = useVisibleTodo();
  const [open, setOpen] = useState(false);

  return (
    <Card className="gap-3 py-4" aria-labelledby="todo-title">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle id="todo-title" role="heading" aria-level={2} className="text-base">
          {t('todoTitle')}
          {all.length > 0 ? (
            <span className="ms-2 inline-flex min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground num">
              {all.length}
            </span>
          ) : null}
        </CardTitle>
        {all.length > shown.length ? (
          <Button variant="ghost" size="sm" className="min-h-11" onClick={() => setOpen(true)}>
            {t('todoSeeAll', { count: all.length })}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {query.isError ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
            {errorMessage(query.error)}
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              {t('todoRetry')}
            </Button>
          </div>
        ) : !query.data ? (
          <div className="space-y-2" aria-busy>
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <CircleCheck className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
            {t('todoEmpty')}
          </p>
        ) : (
          <TodoList items={shown} onLater={later} />
        )}
      </CardContent>
      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent className="md:max-w-2xl">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t('todoTitle')}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>{t('todoAllHint')}</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="max-h-[70dvh] overflow-y-auto">
            <TodoList items={all} onLater={later} />
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </Card>
  );
}

function TodoList({ items, onLater }: { items: TodoItem[]; onLater: (key: string) => void }) {
  return (
    <ul className="divide-y">
      {items.map((i) => (
        <TodoRow key={i.key} item={i} onLater={() => onLater(i.key)} />
      ))}
    </ul>
  );
}

function TodoRow({ item, onLater }: { item: TodoItem; onLater: () => void }) {
  const t = useTranslations('dashboard');
  const canOpen = useCanOpen();
  const Icon = ICONS[item.type];
  const action = todoAction(item);
  const allowed = action && (action.kind === 'call' || canOpen(action.href));
  const start = useRef<{ x: number; y: number } | null>(null);
  const [dx, setDx] = useState(0);

  // Swipe either way to put the row off; a mostly vertical move is a scroll, not a swipe.
  const onTouchStart = (e: TouchEvent) => {
    const p = e.touches[0];
    start.current = p ? { x: p.clientX, y: p.clientY } : null;
  };
  const onTouchMove = (e: TouchEvent) => {
    const p = e.touches[0];
    if (!start.current || !p) return;
    const x = p.clientX - start.current.x;
    if (Math.abs(p.clientY - start.current.y) > Math.abs(x)) return;
    setDx(x);
  };
  const onTouchEnd = () => {
    if (Math.abs(dx) > SWIPE_PX) onLater();
    else setDx(0);
    start.current = null;
  };

  return (
    <li
      className="flex items-center gap-3 py-2 motion-safe:transition-transform motion-safe:duration-200"
      style={
        dx
          ? { transform: `translateX(${dx}px)`, opacity: 1 - Math.min(Math.abs(dx) / 200, 0.6) }
          : undefined
      }
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-full',
          URGENT.has(item.type)
            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
            : 'bg-muted text-muted-foreground',
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm">
          <TodoSentence item={item} />
        </p>
        {item.amount ? (
          <p className="text-xs text-muted-foreground">
            <span dir="ltr" className="num">
              <Amount value={item.amount} />
            </span>
          </p>
        ) : null}
      </div>
      {action && allowed ? (
        <Button asChild size="sm" variant="outline" className="min-h-11 shrink-0">
          {action.kind === 'call' ? (
            <a href={action.href}>{t(`todoAction_${action.kind}`)}</a>
          ) : (
            <Link href={action.href}>{t(`todoAction_${action.kind}`)}</Link>
          )}
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="icon"
        className="size-11 shrink-0 text-muted-foreground"
        aria-label={t('todoLater')}
        title={t('todoLater')}
        onClick={onLater}
      >
        <Clock className="size-4" aria-hidden />
      </Button>
    </li>
  );
}

/** The sentence of an item, from the messages files with its figures. */
function TodoSentence({ item }: { item: TodoItem }) {
  const t = useTranslations('dashboard');
  const name = isolateAuto(item.label ?? '—');
  const days = item.days ?? 0;
  switch (item.type) {
    case 'OUT_OF_STOCK_SOLD':
      return t('todo_OUT_OF_STOCK_SOLD', { name, count: item.count ?? 0 });
    case 'DRAFT_OLD':
      return t(item.document === 'PURCHASE' ? 'todo_DRAFT_OLD_PURCHASE' : 'todo_DRAFT_OLD_SALE', {
        name,
        days,
      });
    default:
      return t(`todo_${item.type}`, { name, days });
  }
}
