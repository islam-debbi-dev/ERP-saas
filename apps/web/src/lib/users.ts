'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AuditLogPage,
  InviteResultDto,
  InviteUserInput,
  ResetPasswordInput,
  TenantSessionDto,
  UpdateUserInput,
  UserDto,
  UserPermissionsInput,
} from '@erp/shared';
import { api } from './api-client';

export interface AuditFilters {
  userId: string;
  entity: string;
  action: string;
  from: string;
  to: string;
}

export const userKeys = {
  all: ['users'] as const,
  sessions: ['sessions'] as const,
  audit: (f: AuditFilters) => ['audit-logs', f] as const,
  facets: ['audit-logs', 'facets'] as const,
};

export function useUsers(enabled = true) {
  return useQuery({
    queryKey: userKeys.all,
    queryFn: ({ signal }) => api.request<UserDto[]>('/users', { signal }),
    enabled,
  });
}

/** Every user mutation refreshes the list (and the sessions a deactivation closes). */
function useUserMutation<TInput, TResult>(fn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: userKeys.all });
      void queryClient.invalidateQueries({ queryKey: userKeys.sessions });
    },
  });
}

export function useInviteUser() {
  return useUserMutation((body: InviteUserInput) =>
    api.request<InviteResultDto>('/users/invite', { method: 'POST', body }),
  );
}

export function useUpdateUser() {
  return useUserMutation(({ id, body }: { id: string; body: UpdateUserInput }) =>
    api.request<UserDto>(`/users/${id}`, { method: 'PUT', body }),
  );
}

export function useSetPermissions() {
  return useUserMutation(({ id, body }: { id: string; body: UserPermissionsInput }) =>
    api.request<UserDto>(`/users/${id}/permissions`, { method: 'PUT', body }),
  );
}

export function useSetActive() {
  return useUserMutation(({ id, active }: { id: string; active: boolean }) =>
    api.request<UserDto>(`/users/${id}/${active ? 'reactivate' : 'deactivate'}`, {
      method: 'POST',
    }),
  );
}

export function useResetPassword() {
  return useUserMutation(({ id, body }: { id: string; body: ResetPasswordInput }) =>
    api.request<InviteResultDto>(`/users/${id}/reset-password`, { method: 'POST', body }),
  );
}

export function useSessions() {
  return useQuery({
    queryKey: userKeys.sessions,
    queryFn: ({ signal }) => api.request<TenantSessionDto[]>('/sessions', { signal }),
  });
}

export function useRevokeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.request<void>(`/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: userKeys.sessions }),
  });
}

export function useAuditLogs(filters: AuditFilters) {
  return useInfiniteQuery({
    queryKey: userKeys.audit(filters),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '50' });
      for (const [k, v] of Object.entries(filters) as [string, string][]) if (v) params.set(k, v);
      if (pageParam) params.set('cursor', pageParam);
      return api.request<AuditLogPage>(`/audit-logs?${params.toString()}`, { signal });
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useAuditFacets() {
  return useQuery({
    queryKey: userKeys.facets,
    queryFn: ({ signal }) =>
      api.request<{ entities: string[]; actions: string[] }>('/audit-logs/facets', { signal }),
  });
}
