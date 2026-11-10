'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, MapPinned } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { RouteDto } from '@erp/shared';
import { EmptyState } from '@/components/shared/empty-state';
import { Button } from '@/components/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api-client';
import { tourneeKeys, useRoutes } from '@/lib/tournees';
import { useErrorMessage } from '@/lib/use-error-message';

/** The API's limit on a tournée (setRouteStopsSchema). */
export const ROUTE_STOPS_MAX = 300;

/**
 * "Ajouter à une tournée…" from the map (phase 35): pick a route of the client's seller;
 * the client goes at the end through the existing PUT /routes/:id/stops, after loading the
 * route so the other stops are kept as they are.
 */
export function AddToRouteDialog({
  client,
  open,
  onOpenChange,
}: {
  client: { id: string; name: string; assignedSellerId: string | null };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('clientMap');
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const routes = useRoutes();
  const list = (routes.data ?? []).filter(
    (r) => !client.assignedSellerId || r.seller.id === client.assignedSellerId,
  );

  const add = useMutation({
    mutationFn: async (routeId: string) => {
      const route = await api.request<RouteDto>(`/routes/${routeId}`);
      const ids = route.stops.map((s) => s.client.id);
      if (ids.includes(client.id)) return { route, already: true };
      if (ids.length >= ROUTE_STOPS_MAX)
        throw new Error(t('tooManyStops', { max: ROUTE_STOPS_MAX }));
      const next = await api.request<RouteDto>(`/routes/${routeId}/stops`, {
        method: 'PUT',
        body: { clientIds: [...ids, client.id] },
      });
      return { route: next, already: false };
    },
    onSuccess: ({ route, already }) => {
      queryClient.setQueryData(tourneeKeys.route(route.id), route);
      void queryClient.invalidateQueries({ queryKey: tourneeKeys.routes });
      const open = { label: t('openRoute'), onClick: () => router.push(`/tournees/${route.id}`) };
      if (already)
        toast.info(t('alreadyOnRoute', { name: client.name, route: route.name }), { action: open });
      else
        toast.success(t('addedToRoute', { name: client.name, route: route.name }), {
          action: open,
        });
      onOpenChange(false);
    },
    onError: (err) => toast.error(err instanceof ApiError ? errorMessage(err) : err.message),
  });

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="md:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('addToRouteTitle')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t('addToRouteHelp', { name: client.name })}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {routes.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : list.length === 0 ? (
          <EmptyState icon={MapPinned} title={t('noRouteForSeller')} />
        ) : (
          <ul className="divide-y rounded-md border">
            {list.map((r) => (
              <li key={r.id}>
                <Button
                  variant="ghost"
                  className="h-auto min-h-12 w-full justify-between gap-2 rounded-none px-3 py-2 text-start"
                  disabled={add.isPending}
                  onClick={() => add.mutate(r.id)}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{r.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {r.seller.fullName} · {t('stopCount', { count: r.stopCount })}
                    </span>
                  </span>
                  {add.isPending && add.variables === r.id ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : null}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
