'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type DashboardLayout,
  defaultDashboardLayout,
  normalizeDashboardLayout,
  Role,
} from '@erp/shared';
import { api } from './api-client';
import { useAuth } from './auth';

const layoutKey = ['dashboard', 'layout'] as const;

/**
 * His dashboard (phase 33.5), saved on the server so it follows him from the PC to the
 * phone. Until it loads, his role's default order.
 */
export function useDashboardLayout(): DashboardLayout {
  const role = useAuth().state.user?.role ?? Role.SELLER;
  const query = useQuery({
    queryKey: layoutKey,
    queryFn: ({ signal }) => api.request<DashboardLayout>('/users/me/dashboard-layout', { signal }),
    staleTime: Infinity,
  });
  return query.data ? normalizeDashboardLayout(query.data, role) : defaultDashboardLayout(role);
}

export function useSaveDashboardLayout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (layout: DashboardLayout) =>
      api.request<DashboardLayout>('/users/me/dashboard-layout', { method: 'PATCH', body: layout }),
    onSuccess: (saved) => queryClient.setQueryData(layoutKey, saved),
  });
}
