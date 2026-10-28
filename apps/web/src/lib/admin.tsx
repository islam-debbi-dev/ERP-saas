'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type {
  AdminAuthResponse,
  AdminInfo,
  AdminLoginInput,
  AdminTenantDetail,
  AdminTenantRow,
  AdminTenantsQuery,
  ImpersonationResponse,
  RecordSubscriptionPaymentInput,
  SubscriptionSummary,
  UpdateSubscriptionInput,
} from '@erp/shared';
import { ApiClient, ApiError } from './api-client';

/**
 * The super-admin's own client: admin token in memory, refresh cookie scoped to
 * /admin/auth. It never shares a token with the company client (`api`).
 */
export const adminApi = new ApiClient({
  baseUrl: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001',
  authPath: '/admin/auth',
  onSessionEnd: () => {
    if (typeof window !== 'undefined' && window.location.pathname !== '/admin/login') {
      // Full reload on purpose: drops the admin token and every cached admin query.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign('/admin/login');
    }
  },
});

/** Like `sessionHint`: only ask for an admin refresh when this browser has signed in. */
const ADMIN_HINT = 'erp_admin_hint';
function adminHint(value?: boolean): boolean {
  try {
    if (value !== undefined) window.localStorage.setItem(ADMIN_HINT, value ? '1' : '0');
    return window.localStorage.getItem(ADMIN_HINT) === '1';
  } catch {
    return true;
  }
}

type AdminState =
  | { status: 'loading'; admin: null }
  | { status: 'authenticated'; admin: AdminInfo }
  | { status: 'anonymous'; admin: null };

interface AdminAuthValue {
  state: AdminState;
  login: (input: AdminLoginInput) => Promise<void>;
  logout: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthValue | null>(null);

export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AdminState>({ status: 'loading', admin: null });

  const accept = useCallback((auth: AdminAuthResponse) => {
    adminApi.setAccessToken(auth.accessToken);
    adminHint(true);
    setState({ status: 'authenticated', admin: auth.admin });
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!adminHint()) {
      queueMicrotask(() => setState({ status: 'anonymous', admin: null }));
      return;
    }
    adminApi
      .refresh()
      .then((auth) => {
        // The admin refresh answers an AdminAuthResponse.
        if (!cancelled) accept(auth as unknown as AdminAuthResponse);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) adminHint(false);
        if (!cancelled) setState({ status: 'anonymous', admin: null });
      });
    return () => {
      cancelled = true;
    };
  }, [accept]);

  const value = useMemo<AdminAuthValue>(
    () => ({
      state,
      login: async (input) => {
        accept(
          await adminApi.request<AdminAuthResponse>('/admin/auth/login', {
            method: 'POST',
            body: input,
          }),
        );
      },
      logout: async () => {
        try {
          await adminApi.request('/admin/auth/logout', { method: 'POST' });
        } catch (err) {
          if (!(err instanceof ApiError)) throw err;
        }
        adminApi.setAccessToken(null);
        adminHint(false);
        queryClient.removeQueries({ queryKey: adminKeys.all });
        setState({ status: 'anonymous', admin: null });
      },
    }),
    [state, accept, queryClient],
  );

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth(): AdminAuthValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error('useAdminAuth must be used inside AdminAuthProvider');
  return ctx;
}

export const adminKeys = {
  all: ['admin'] as const,
  tenants: (q: AdminTenantsQuery) => ['admin', 'tenants', q] as const,
  tenant: (id: string) => ['admin', 'tenant', id] as const,
};

export function useAdminTenants(query: AdminTenantsQuery, enabled: boolean) {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.status) params.set('status', query.status);
  const qs = params.toString();
  return useQuery({
    queryKey: adminKeys.tenants(query),
    queryFn: () => adminApi.request<AdminTenantRow[]>(`/admin/tenants${qs ? `?${qs}` : ''}`),
    enabled,
  });
}

export function useAdminTenant(id: string, enabled: boolean) {
  return useQuery({
    queryKey: adminKeys.tenant(id),
    queryFn: () => adminApi.request<AdminTenantDetail>(`/admin/tenants/${id}`),
    enabled,
  });
}

function useRefreshTenant(id: string) {
  const queryClient = useQueryClient();
  return (summary: SubscriptionSummary) => {
    queryClient.setQueryData<AdminTenantDetail>(adminKeys.tenant(id), (old) =>
      old ? { ...old, ...summary } : old,
    );
    void queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] });
  };
}

export function useRecordPayment(id: string) {
  const refresh = useRefreshTenant(id);
  return useMutation({
    mutationFn: ({ body, key }: { body: RecordSubscriptionPaymentInput; key: string }) =>
      adminApi.request<SubscriptionSummary>(`/admin/tenants/${id}/payments`, {
        method: 'POST',
        body,
        idempotencyKey: key,
      }),
    onSuccess: refresh,
  });
}

export function useUpdateSubscription(id: string) {
  const refresh = useRefreshTenant(id);
  return useMutation({
    mutationFn: (body: UpdateSubscriptionInput) =>
      adminApi.request<SubscriptionSummary>(`/admin/tenants/${id}/subscription`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: refresh,
  });
}

export function useImpersonate(id: string) {
  return useMutation({
    mutationFn: () =>
      adminApi.request<ImpersonationResponse>(`/admin/tenants/${id}/impersonate`, {
        method: 'POST',
      }),
  });
}
