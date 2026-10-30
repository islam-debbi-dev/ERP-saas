'use client';

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
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
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Archive,
  GripVertical,
  Loader2,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Feature, type RouteDto, type RouteStopDto, type UpdateRouteInput } from '@erp/shared';
import { ClientPicker } from '@/components/sales/client-picker';
import { EmptyState } from '@/components/shared/empty-state';
import { FeatureGate } from '@/components/shared/feature-gate';
import { PageHeader } from '@/components/shared/page-header';
import { StickyActions } from '@/components/shared/sticky-actions';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api-client';
import { useSellers } from '@/lib/sales-force';
import { tourneeKeys, useRoute } from '@/lib/tournees';
import { useErrorMessage } from '@/lib/use-error-message';
import { WeekdayPicker } from './weekdays';

type Stop = RouteStopDto['client'];

/** Tournées > one route: its seller and days, and the ordered list of its clients. */
export function RouteEditor({ id }: { id: string }) {
  return (
    <FeatureGate feature={Feature.TOURNEES}>
      <Editor id={id} />
    </FeatureGate>
  );
}

function Editor({ id }: { id: string }) {
  const t = useTranslations('tournees');
  const errorMessage = useErrorMessage();
  const route = useRoute(id);
  if (route.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{errorMessage(route.error)}</AlertDescription>
      </Alert>
    );
  }
  if (!route.data) {
    return (
      <>
        <PageHeader title={t('title')} />
        <Skeleton className="h-64 w-full" aria-busy />
      </>
    );
  }
  // Remount on a new version from the server so the local copy starts from it.
  return <Loaded key={`${route.data.id}:${route.data.stops.length}`} route={route.data} />;
}

function Loaded({ route }: { route: RouteDto }) {
  const t = useTranslations('tournees');
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const queryClient = useQueryClient();
  const sellers = useSellers();
  const [name, setName] = useState(route.name);
  const [sellerId, setSellerId] = useState(route.seller.id);
  const [weekdays, setWeekdays] = useState(route.weekdays);
  const [active, setActive] = useState(route.active);
  const [stops, setStops] = useState<Stop[]>(route.stops.map((s) => s.client));
  const [picking, setPicking] = useState(false);
  const [announce, setAnnounce] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // A short press before dragging, so a finger can still scroll the list.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const headerDirty =
    name !== route.name ||
    sellerId !== route.seller.id ||
    active !== route.active ||
    weekdays.join() !== route.weekdays.join();
  const stopsDirty = stops.map((s) => s.id).join() !== route.stops.map((s) => s.client.id).join();

  // Leaving with unsaved stops loses the work: ask the browser to confirm.
  useEffect(() => {
    if (!headerDirty && !stopsDirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [headerDirty, stopsDirty]);

  const save = useMutation({
    mutationFn: async () => {
      let next = route;
      if (headerDirty) {
        const body: UpdateRouteInput = { name: name.trim(), sellerId, weekdays, active };
        next = await api.request<RouteDto>(`/routes/${route.id}`, { method: 'PATCH', body });
      }
      if (stopsDirty) {
        next = await api.request<RouteDto>(`/routes/${route.id}/stops`, {
          method: 'PUT',
          body: { clientIds: stops.map((s) => s.id) },
        });
      }
      return next;
    },
    onSuccess: (next) => {
      queryClient.setQueryData(tourneeKeys.route(route.id), next);
      void queryClient.invalidateQueries({ queryKey: tourneeKeys.routes });
      void queryClient.invalidateQueries({ queryKey: tourneeKeys.today });
      toast.success(t('saved'));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const archive = useMutation({
    mutationFn: () => api.request<void>(`/routes/${route.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tourneeKeys.routes });
      router.push('/tournees');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const move = (from: number, to: number) => {
    if (to < 0 || to >= stops.length) return;
    const moved = stops[from];
    setStops(arrayMove(stops, from, to));
    if (moved) setAnnounce(t('movedTo', { name: moved.name, position: to + 1 }));
  };

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = stops.findIndex((s) => s.id === e.active.id);
    const to = stops.findIndex((s) => s.id === e.over?.id);
    if (from >= 0 && to >= 0) move(from, to);
  };

  const valid = name.trim().length > 0 && weekdays.length > 0;

  return (
    <>
      <PageHeader
        title={route.name}
        description={t('stopCount', { count: stops.length })}
        more={[
          {
            label: t('archive'),
            icon: Archive,
            tone: 'destructive',
            disabled: archive.isPending,
            onSelect: () => {
              if (window.confirm(t('archiveConfirm'))) archive.mutate();
            },
          },
          { label: t('back'), icon: ArrowLeft, flipIcon: true, tone: 'ghost', href: '/tournees' },
        ]}
      />

      <Card className="py-4">
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="route-name">{t('routeName')}</Label>
            <Input
              id="route-name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="route-seller">{t('seller')}</Label>
            <NativeSelect
              id="route-seller"
              value={sellerId}
              onChange={(e) => setSellerId(e.target.value)}
            >
              {(sellers.data ?? [route.seller]).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                </option>
              ))}
            </NativeSelect>
          </div>
          <WeekdayPicker value={weekdays} onChange={setWeekdays} />
          <div className="flex min-h-11 items-center gap-3 self-end">
            <Switch id="route-active" checked={active} onCheckedChange={setActive} />
            <Label htmlFor="route-active">{t('activeRoute')}</Label>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t('stops')}</h2>
        <Button variant="outline" onClick={() => setPicking(true)}>
          <Plus aria-hidden />
          {t('addStop')}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{t('reorderHelp')}</p>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>

      <Card className="p-0">
        {stops.length === 0 ? (
          <EmptyState icon={Plus} title={t('noStopsTitle')} description={t('noStopsDescription')} />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={stops.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <ol className="divide-y">
                {stops.map((s, i) => (
                  <SortableStop
                    key={s.id}
                    stop={s}
                    index={i}
                    last={i === stops.length - 1}
                    onMove={move}
                    onRemove={() => setStops(stops.filter((x) => x.id !== s.id))}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        )}
      </Card>

      <StickyActions>
        <Button
          disabled={!valid || (!headerDirty && !stopsDirty) || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
          {t('saveRoute')}
        </Button>
      </StickyActions>

      <ClientPicker
        open={picking}
        onOpenChange={setPicking}
        withCounter={false}
        onPick={(c) => {
          if (!c) return;
          if (stops.some((s) => s.id === c.id)) {
            toast.info(t('alreadyOnRoute', { name: c.name }));
            return;
          }
          setStops([
            ...stops,
            { id: c.id, code: c.code, name: c.name, commune: c.commune, phone: c.phone },
          ]);
        }}
      />
    </>
  );
}

function SortableStop({
  stop,
  index,
  last,
  onMove,
  onRemove,
}: {
  stop: Stop;
  index: number;
  last: boolean;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('tournees');
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: stop.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex min-h-14 items-center gap-2 bg-card px-2 py-2 ${isDragging ? 'relative z-10 shadow-md' : ''}`}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="flex size-11 shrink-0 touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label={t('dragHandle', { name: stop.name })}
        {...attributes}
        {...listeners}
      >
        <GripVertical aria-hidden />
      </button>
      <span className="num w-6 shrink-0 text-center text-sm text-muted-foreground">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" title={stop.name}>
          {stop.name}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          <span dir="ltr">{stop.code}</span>
          {stop.commune ? ` · ${stop.commune}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 items-center">
        <Button
          variant="ghost"
          size="icon"
          className="size-11 max-sm:hidden"
          aria-label={t('moveUp', { name: stop.name })}
          disabled={index === 0}
          onClick={() => onMove(index, index - 1)}
        >
          <ArrowUp aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 max-sm:hidden"
          aria-label={t('moveDown', { name: stop.name })}
          disabled={last}
          onClick={() => onMove(index, index + 1)}
        >
          <ArrowDown aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label={t('removeStop', { name: stop.name })}
          onClick={onRemove}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
    </li>
  );
}
