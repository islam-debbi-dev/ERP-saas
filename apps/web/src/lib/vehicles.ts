'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type AssignDriverInput,
  type AssignDriverResultDto,
  type ConvertRoutesResultDto,
  type CreateVehicleTypeInput,
  Feature,
  type RouteDto,
  type UpdateVehicleTypeInput,
  type VehicleAssignmentPage,
  type VehicleTypeDto,
  type WarehouseDto,
  WarehouseType,
  type WorkerVehiclePage,
  OFFICE_ROLES,
} from '@erp/shared';
import { api } from './api-client';
import { useAuth, useFeature } from './auth';
import { useSellers } from './sales-force';
import { stockKeys, useWarehouses } from './stock';
import { tourneeKeys, useDeliverers } from './tournees';

export const vehicleKeys = {
  types: ['vehicle-types'] as const,
  history: (vehicleId: string) => ['warehouses', vehicleId, 'assignments'] as const,
  ofUser: (userId: string) => ['users', userId, 'vehicle-assignments'] as const,
};

/** The company's own kinds of trucks (phase 36). */
export function useVehicleTypes() {
  const enabled = useFeature(Feature.WAREHOUSES);
  return useQuery({
    queryKey: vehicleKeys.types,
    queryFn: ({ signal }) => api.request<VehicleTypeDto[]>('/vehicle-types', { signal }),
    enabled,
    staleTime: 60_000,
  });
}

export function useSaveVehicleType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string | null;
      body: CreateVehicleTypeInput | UpdateVehicleTypeInput;
    }) =>
      api.request<VehicleTypeDto>(id ? `/vehicle-types/${id}` : '/vehicle-types', {
        method: id ? 'PATCH' : 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: vehicleKeys.types });
      // Trucks show their type's code and name.
      void queryClient.invalidateQueries({ queryKey: stockKeys.warehouses });
    },
  });
}

export function useArchiveVehicleType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.request<void>(`/vehicle-types/${id}/archive`, { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: vehicleKeys.types }),
  });
}

/** The live trucks the user sees, from the dépôts list every screen already shares. */
export function useVehicles(): { data: WarehouseDto[] | undefined; isPending: boolean } {
  const warehouses = useWarehouses();
  return {
    data: warehouses.data?.filter((w) => w.type === WarehouseType.VEHICLE),
    isPending: warehouses.isPending,
  };
}

/** Who can be put on a truck: sellers, and livreurs for the delivery trucks. */
export function useDriverOptions(): { id: string; fullName: string }[] {
  const role = useAuth().state.user?.role;
  const tournees = useFeature(Feature.TOURNEES);
  const planner = !!role && OFFICE_ROLES.includes(role);
  const sellers = useSellers();
  const deliverers = useDeliverers(tournees && planner);
  const byId = new Map<string, { id: string; fullName: string }>();
  for (const u of [...(sellers.data ?? []), ...(deliverers.data ?? [])]) {
    byId.set(u.id, { id: u.id, fullName: u.fullName });
  }
  return [...byId.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/** Today's driver of a truck. Tournées, "aujourd'hui" and orders follow the truck. */
export function useAssignDriver() {
  const queryClient = useQueryClient();
  return useMutation({
    // `key`: one per choice in the dialog, so a retry after a lost answer is a replay and
    // never undoes a later change (test-36 B-4).
    mutationFn: ({
      vehicleId,
      body,
      key,
    }: {
      vehicleId: string;
      body: AssignDriverInput;
      key: string;
    }) =>
      api.request<AssignDriverResultDto>(`/warehouses/${vehicleId}/driver`, {
        method: 'POST',
        body,
        idempotencyKey: key,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: stockKeys.warehouses });
      void queryClient.invalidateQueries({ queryKey: tourneeKeys.routes });
      void queryClient.invalidateQueries({ queryKey: tourneeKeys.today });
      void queryClient.invalidateQueries({ queryKey: tourneeKeys.orders });
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

const page = (cursor: string | null) => {
  const params = new URLSearchParams({ limit: '20' });
  if (cursor) params.set('cursor', cursor);
  return params.toString();
};

/** Who drove a truck, newest first. */
export function useVehicleHistory(vehicleId: string | null) {
  return useInfiniteQuery({
    queryKey: vehicleKeys.history(vehicleId ?? ''),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api.request<VehicleAssignmentPage>(
        `/warehouses/${vehicleId}/assignments?${page(pageParam)}`,
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor,
    enabled: vehicleId !== null,
  });
}

/** The trucks a worker drove, newest first. */
export function useWorkerVehicles(userId: string | null) {
  const on = useFeature(Feature.WAREHOUSES);
  return useInfiniteQuery({
    queryKey: vehicleKeys.ofUser(userId ?? ''),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api.request<WorkerVehiclePage>(`/users/${userId}/vehicle-assignments?${page(pageParam)}`, {
        signal,
      }),
    getNextPageParam: (last) => last.nextCursor,
    enabled: on && userId !== null,
  });
}

function useRouteMutation<TInput, TResult>(fn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tourneeKeys.routes });
      void queryClient.invalidateQueries({ queryKey: tourneeKeys.today });
    },
  });
}

/** "Convertir en tournée véhicule": the route goes to the truck its seller drives. */
export function useConvertRoute() {
  return useRouteMutation((id: string) =>
    api.request<RouteDto>(`/routes/${id}/convert-to-vehicle`, {
      method: 'POST',
      idempotencyKey: crypto.randomUUID(),
    }),
  );
}

export function useConvertAllRoutes() {
  return useRouteMutation(() =>
    api.request<ConvertRoutesResultDto>('/routes/convert-to-vehicle', {
      method: 'POST',
      idempotencyKey: crypto.randomUUID(),
    }),
  );
}
